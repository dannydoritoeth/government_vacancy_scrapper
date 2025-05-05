import puppeteer from "puppeteer";
import settings from "../settings.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import chalk from "chalk";
import process from "process";
import readline from 'readline';

/**
 * @description Scrapes jobs from Seek website for DCCEEW
 */
export class SeekJobSpider {
  #name = "seek jobs";
  #baseUrl = "https://www.seek.com.au";
  #allowedDomains = [
    "https://www.seek.com.au/Department-of-Climate-Change,-Energy,-the-Environment-and-Water-jobs/in-All-Sydney-NSW/full-time"
  ];
  #cachedJobs = new Map();

  constructor() {
    this.browser = null;
    this.page = null;
    this.pageSize = 22; // Default page size on Seek
    this.loadCache();
  }

  /**
   * @description Creates a readline interface for user input
   * @returns {Promise<void>}
   */
  async #waitForUserInput(message) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    return new Promise(resolve => {
      rl.question(chalk.yellow(`\n${message}\nPress Enter to continue...`), () => {
        rl.close();
        resolve();
      });
    });
  }

  /**
   * @description Checks if the page has Cloudflare verification
   * @returns {Promise<boolean>}
   */
  async #hasCloudflareVerification() {
    try {
      return await this.page.evaluate(() => {
        return document.title.includes('SEEK secure') || 
               document.body.textContent.includes('Help us keep SEEK secure') ||
               !!document.querySelector('.cloudflare-challenge');
      });
    } catch (error) {
      return false;
    }
  }

  /**
   * @description Loads previously scraped jobs from the cache
   */
  loadCache() {
    try {
      const cacheDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "database", "jobs");
      
      // Create directories if they don't exist
      if (!fs.existsSync(cacheDir)) {
        fs.mkdirSync(cacheDir, { recursive: true });
        return;
      }

      // Read all JSON files in the jobs directory
      const files = fs.readdirSync(cacheDir).filter(file => file.endsWith('.json'));
      
      for (const file of files) {
        const content = fs.readFileSync(path.join(cacheDir, file), 'utf8');
        const data = JSON.parse(content);
        
        // Add each job to the cache with its jobId as the key
        if (data.jobs) {
          data.jobs.forEach(job => {
            if (job.jobId && job.details) {
              this.#cachedJobs.set(job.jobId, {
                lastScraped: data.metadata.date_scraped,
                details: job.details
              });
            }
          });
        }
      }
      
      console.log(chalk.cyan(`Loaded ${this.#cachedJobs.size} jobs from cache`));
    } catch (error) {
      console.log(chalk.yellow(`Error loading cache: ${error.message}`));
    }
  }

  /**
   * @description Checks if a job needs to be re-scraped based on its ID and last scrape date
   * @param {string} jobId - The job ID to check
   * @returns {Object|null} Returns cached details if valid, null if needs re-scraping
   */
  #checkCache(jobId) {
    if (!this.#cachedJobs.has(jobId)) return null;

    const cached = this.#cachedJobs.get(jobId);
    const lastScraped = new Date(cached.lastScraped);
    const now = new Date();
    
    // Re-scrape if the cache is older than 24 hours
    if (now - lastScraped > 24 * 60 * 60 * 1000) {
      return null;
    }

    return cached.details;
  }

  /**
   * @description Set's up puppeteer browser settings and handles verification
   */
  async launch() {
    console.log(chalk.bold.magenta(`"${this.#name}" spider launched.`));
    try {
      this.browser = await puppeteer.launch({
        ...settings,
        headless: false // Set to false to show the browser for verification
      });
      
      this.page = await this.browser.newPage();
      
      // Navigate to the main page first
      console.log(chalk.cyan("Navigating to Seek jobs page..."));
      await this.page.goto(this.#allowedDomains[0], { waitUntil: 'networkidle0' });

      // Check for Cloudflare verification
      if (await this.#hasCloudflareVerification()) {
        // Take a screenshot of the verification page
        await this.page.screenshot({ path: 'seek-verification.png' });
        
        console.log(chalk.yellow("\nCloudflare verification detected!"));
        console.log(chalk.cyan("Please complete the verification in the browser window."));
        
        // Wait for user to complete verification
        await this.#waitForUserInput("After completing the verification in the browser window");
        
        // Wait for navigation after verification
        await this.page.waitForNavigation({ waitUntil: 'networkidle0' });
      }

      await this.#crawl();
    } catch (error) {
      console.log(chalk.red(error));
      await this.#terminate();
    }
  }

  /**
   * @description Creates the database path for storing scraped data
   * @param {string} filename - The name of the file
   * @param {string} type - The type of data (jobs or errors)
   * @returns {string} The full path to save the file
   */
  #databasePath(filename, type = "jobs") {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    return path.join(__dirname, "..", "database", type, `${filename}.json`);
  }

  /**
   * @description Formats date strings
   * @param {string} format - The desired format (date or timestamp)
   * @returns {string} Formatted date string
   */
  #date(format = "date") {
    const date = new Date();
    const pad = (num) => num.toString().padStart(2, "0");
    
    if (format === "date") {
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    }
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
  }

  /**
   * @description Terminates the browser instance
   */
  async #terminate() {
    if (this.browser) {
      await this.browser.close();
      console.log(chalk.bold.red(`"${this.#name}" spider terminated.`));
    }
  }

  /**
   * @description Initiates crawling processes & procedures.
   */
  async #crawl() {
    console.log(chalk.bold.magenta(`"${this.#name}" spider crawling.`));
    try {
      if (this.page) {
        this.page.setDefaultNavigationTimeout(200000);
        
        // Initialize empty array to store all jobs
        let allJobs = [];
        let currentPage = 1;
        let hasMoreJobs = true;

        // First, get the total number of jobs from the first page
        console.log(chalk.cyan("Navigating to Seek jobs page..."));
        await this.page.goto(this.#allowedDomains[0], { waitUntil: 'networkidle0' });
        
        // Wait for either the jobs message or a potential error message
        try {
          await this.page.waitForSelector('[data-automation="totalJobsMessage"], [data-automation="searchErrorMessage"]', { timeout: 30000 });
        } catch (error) {
          console.log(chalk.yellow("Could not find jobs count or error message. Taking screenshot..."));
          await this.page.screenshot({ path: 'seek-error.png' });
          throw new Error("Failed to load Seek jobs page properly");
        }

        // Check if we got an error message
        const errorMessage = await this.page.evaluate(() => {
          const errorElem = document.querySelector('[data-automation="searchErrorMessage"]');
          return errorElem ? errorElem.textContent : null;
        });

        if (errorMessage) {
          throw new Error(`Seek returned an error: ${errorMessage}`);
        }
        
        const totalJobs = await this.page.evaluate(() => {
          const resultsText = document.querySelector('[data-automation="totalJobsMessage"]')?.textContent;
          const match = resultsText?.match(/(\d+)\s+jobs?/);
          return match ? parseInt(match[1]) : 0;
        });

        if (!totalJobs) {
          console.log(chalk.yellow("No jobs found on Seek. Taking screenshot for debugging..."));
          await this.page.screenshot({ path: 'seek-no-jobs.png' });
          throw new Error("No jobs found on Seek");
        }

        const totalPages = Math.ceil(totalJobs / this.pageSize);
        console.log(chalk.cyan(`Found ${totalJobs} total jobs across ${totalPages} pages`));

        while (hasMoreJobs && currentPage <= totalPages) {
          console.log(chalk.cyan(`\nProcessing page ${currentPage} of ${totalPages}...`));
          
          if (currentPage > 1) {
            const nextPageUrl = `${this.#allowedDomains[0]}?page=${currentPage}`;
            await this.page.goto(nextPageUrl);
            await this.page.waitForSelector('[data-automation="jobTitle"]');
          }
          
          const jobs = await this.#scrapeJobs();
          if (jobs.length === 0) {
            hasMoreJobs = false;
          } else {
            allJobs = [...allJobs, ...jobs];
            currentPage++;
          }
        }

        // Log final statistics
        console.log(chalk.cyan('\n----------------------------------------'));
        console.log(chalk.cyan(`Total pages processed: ${currentPage - 1}`));
        console.log(chalk.cyan(`Total jobs found: ${allJobs.length} / ${totalJobs}`));
        console.log(chalk.green(`Jobs created/updated: ${allJobs.length}`));
        console.log(chalk.yellow(`Jobs skipped: 0`));
        console.log(chalk.cyan('----------------------------------------'));
        
        // Save the scraped data
        fs.writeFile(
          this.#databasePath(this.#date("date")),
          JSON.stringify({
            metadata: {
              total_jobs: allJobs.length,
              expected_total_jobs: totalJobs,
              total_pages: currentPage - 1,
              jobs_created: allJobs.length,
              jobs_skipped: 0,
              date_scraped: this.#date("timestamp")
            },
            jobs: allJobs
          }, null, 2),
          (error) => {
            if (error) {
              console.log(chalk.red(error.message));
            } else {
              console.log(chalk.green(`Jobs saved to database for ${this.#date("date")}`));
            }
          }
        );

        await this.#terminate();
      }
    } catch (err) {
      console.log(chalk.red(`Error in crawl: ${err.message}`));
      if (this.page) {
        console.log(chalk.yellow("Taking error screenshot..."));
        await this.page.screenshot({ path: `seek-error-${this.#date("timestamp")}.png` });
      }
      await this.#terminate();
      throw err; // Re-throw to be caught by the main error handler
    }
  }

  /**
   * @description Scrapes job listings from the page
   * @returns {Promise<Array>} Array of job objects
   */
  async #scrapeJobs() {
    try {
      const jobs = [];
      let totalJobs = 0;
      let successfulScrapes = 0;
      let failedScrapes = 0;
      let skippedJobs = 0;
      
      // Wait for job elements to load with a more specific selector
      await this.page.waitForSelector('article[data-automation="premiumJob"], article[data-automation="normalJob"]', {
        timeout: 30000
      });
      
      // Add a small delay to ensure dynamic content is loaded
      await this.page.waitForTimeout(2000);
      
      // Get all job listings data in one go
      const jobListings = await this.page.evaluate(() => {
        return Array.from(document.querySelectorAll('article[data-automation="premiumJob"], article[data-automation="normalJob"]')).map(element => {
          try {
            // Title and URL
            const titleElement = element.querySelector('[data-automation="jobTitle"]');
            const title = titleElement?.textContent?.trim() || '';
            const jobUrl = titleElement?.href || '';
            
            // Job ID
            const jobId = element.getAttribute('data-job-id') || '';
            
            // Company name
            const company = element.querySelector('[data-automation="jobCompany"]')?.textContent?.trim() || '';
            
            // Location
            const location = element.querySelector('[data-automation="jobLocation"]')?.textContent?.trim() || '';
            
            // Work type (if available)
            const workArrangement = element.querySelector('[data-testid="work-arrangement"]')?.textContent?.trim().replace(/[()]/g, '') || '';
            
            // Classification
            const classification = element.querySelector('[data-automation="jobClassification"]')?.textContent?.trim().replace(/[()]/g, '') || '';
            const subClassification = element.querySelector('[data-automation="jobSubClassification"]')?.textContent?.trim() || '';
            
            // Description snippet
            const description = element.querySelector('[data-automation="jobShortDescription"]')?.textContent?.trim() || '';
            
            // Bullet points
            const bulletPoints = Array.from(element.querySelectorAll('ul li span')).map(li => li.textContent?.trim()).filter(Boolean);
            
            return {
              title,
              company,
              location,
              workArrangement,
              classification,
              subClassification,
              bulletPoints,
              description,
              jobId,
              jobUrl
            };
          } catch (error) {
            console.error("Error parsing job listing:", error);
            return null;
          }
        }).filter(Boolean); // Remove any null entries from failed parsing
      });

      totalJobs = jobListings.length;
      console.log(chalk.cyan(`Found ${totalJobs} job listings to process...`));
      
      // Process each job listing
      for (const jobInfo of jobListings) {
        try {
          // Check cache before fetching details
          const cachedDetails = this.#checkCache(jobInfo.jobId);
          if (cachedDetails) {
            jobInfo.details = cachedDetails;
            skippedJobs++;
            successfulScrapes++;
            jobs.push(jobInfo);
            process.stdout.write(`\rProcessed: ${successfulScrapes}/${totalJobs} jobs (${skippedJobs} from cache)`);
            continue;
          }

          // Fetch detailed job information if not in cache
          console.log(chalk.cyan(`\nFetching details for: ${jobInfo.title}`));
          
          const jobDetails = await this.#scrapeJobDetails(jobInfo.jobUrl, jobInfo.jobId);
          
          // Merge the job listing with its details
          const completeJob = {
            ...jobInfo,
            details: jobDetails
          };
          
          jobs.push(completeJob);
          successfulScrapes++;
          process.stdout.write(`\rProcessed: ${successfulScrapes}/${totalJobs} jobs (${skippedJobs} from cache)`);
        } catch (error) {
          failedScrapes++;
          console.log(chalk.yellow(`\nError scraping job: ${error.message}`));
        }
      }
      
      console.log('\n');
      console.log(chalk.cyan('Job Processing Summary:'));
      console.log(chalk.green(`Successfully scraped: ${successfulScrapes} jobs`));
      console.log(chalk.blue(`Jobs loaded from cache: ${skippedJobs}`));
      console.log(chalk.yellow(`Failed to scrape: ${failedScrapes} jobs`));
      
      return jobs;
    } catch (error) {
      console.log(chalk.red(`Error in scrapeJobs: ${error.message}`));
      if (this.page) {
        await this.page.screenshot({ path: `seek-scrape-error-${this.#date("timestamp")}.png` });
      }
      throw error;
    }
  }

  /**
   * @description Scrapes detailed job information from the job page
   * @param {string} jobUrl - URL of the job listing
   * @param {string} jobId - ID of the job
   * @returns {Promise<Object>} Detailed job information
   */
  async #scrapeJobDetails(jobUrl, jobId) {
    // Check cache first
    const cachedDetails = this.#checkCache(jobId);
    if (cachedDetails) {
      console.log(chalk.green(`Using cached data for job ID: ${jobId}`));
      return cachedDetails;
    }

    try {
      // Create a new page for each job detail to avoid context issues
      const detailPage = await this.browser.newPage();
      await detailPage.goto(jobUrl);
      await detailPage.waitForSelector('[data-automation="jobAdDetails"]');

      const jobDetails = await detailPage.evaluate(() => {
        // Get the full job description
        const description = document.querySelector('[data-automation="jobAdDetails"]')?.innerHTML?.trim() || '';
        
        // Get salary information if available
        const salary = document.querySelector('[data-automation="job-detail-salary"]')?.textContent?.trim() || '';
        
        // Get work type
        const workType = document.querySelector('[data-automation="job-detail-work-type"]')?.textContent?.trim() || '';
        
        // Get listing date
        const listingDate = document.querySelector('[data-automation="job-detail-date"]')?.textContent?.trim() || '';

        // Get additional details
        const additionalDetails = Array.from(document.querySelectorAll('[data-automation="jobAdDetails"] p'))
          .map(p => p.textContent?.trim())
          .filter(Boolean);

        return {
          description,
          salary,
          workType,
          listingDate,
          additionalDetails,
          metadata: {
            lastScraped: new Date().toISOString()
          }
        };
      });

      // Close the detail page
      await detailPage.close();

      // Add to cache
      this.#cachedJobs.set(jobId, {
        lastScraped: new Date().toISOString(),
        details: jobDetails
      });

      return jobDetails;
    } catch (error) {
      console.log(chalk.yellow(`Error scraping job details from ${jobUrl}: ${error.message}`));
      return null;
    }
  }
} 