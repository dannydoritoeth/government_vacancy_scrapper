import puppeteer from "puppeteer";
import settings from "../settings.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import chalk from "chalk";
import process from "process";

/**
 * @description Scrapes jobs from NSW Government jobs website
 */
export class NSWJobSpider {
  #name = "nsw gov jobs";
  #baseUrl = "https://iworkfor.nsw.gov.au";
  #allowedDomains = [
    "https://iworkfor.nsw.gov.au/jobs/all-keywords/all-agencies/department-of-climate-change,-energy,-the-environment-and-water-/all-categories/all-locations/all-worktypes?agenciesid=9116&sortby=RelevanceDesc"
  ];
  #cachedJobs = new Map();

  constructor() {
    this.browser = null;
    this.page = null;
    this.pageSize = 25; // Default page size
    this.loadCache();
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
   * @description Constructs the URL for a specific page
   * @param {number} pageNumber - The page number to fetch
   * @returns {string} The complete URL with pagination parameters
   */
  #getPageUrl(pageNumber) {
    return `${this.#allowedDomains[0]}&page=${pageNumber}&pagesize=${this.pageSize}`;
  }

  /**
   * @description Set's up puppeteer browser settings.
   */
  async launch() {
    console.log(chalk.bold.magenta(`"${this.#name}" spider launched.`));
    try {
      this.browser = await puppeteer.launch(settings);
      this.page = await this.browser.newPage();
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
    const dbPath = path.join(__dirname, "..", "database", type, `nswgov-${filename}.json`);
    console.log(chalk.cyan(`Database path: ${dbPath}`));
    return dbPath;
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
        await this.page.goto(this.#getPageUrl(1));
        await this.page.waitForSelector('.job-card');
        
        const totalJobs = await this.page.evaluate(() => {
          const resultsText = document.querySelector('div[b-n96x1o845s]')?.textContent;
          const match = resultsText?.match(/(\d+)\s+jobs match/);
          return match ? parseInt(match[1]) : 0;
        });

        const totalPages = Math.ceil(totalJobs / this.pageSize);
        console.log(chalk.cyan(`Found ${totalJobs} total jobs across ${totalPages} pages`));

        while (currentPage <= totalPages) {
          console.log(chalk.cyan(`\nProcessing page ${currentPage} of ${totalPages}...`));
          
          if (currentPage > 1) {
            await this.page.goto(this.#getPageUrl(currentPage));
            await this.page.waitForSelector('.job-card');
          }
          
          const jobs = await this.#scrapeJobs();
          allJobs = [...allJobs, ...jobs];
          
          currentPage++;
        }

        // Log final statistics
        console.log(chalk.cyan('\n----------------------------------------'));
        console.log(chalk.cyan(`Total pages processed: ${totalPages}`));
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
              total_pages: totalPages,
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
      console.log(chalk.red(err));
      await this.#terminate();
      
      // Log errors
      fs.writeFile(
        this.#databasePath(`Error at ${this.#date("timestamp")}`, "errors"),
        JSON.stringify(
          {
            text: err.message,
            date: this.#date("date"),
            metadata: {
              total_jobs_attempted: 0,
              jobs_created: 0,
              jobs_skipped: 0,
              pages_processed: 0,
              error_occurred: true
            }
          },
          null,
          2
        ),
        (error) => error && console.log(chalk.red(error.message))
      );
    }
  }

  /**
   * @description Scrapes job listings from the page
   * @returns {Promise<Array>} Array of job objects
   */
  async #scrapeJobs() {
    const jobs = [];
    let totalJobs = 0;
    let successfulScrapes = 0;
    let failedScrapes = 0;
    let skippedJobs = 0;
    
    // Wait for job elements to load
    await this.page.waitForSelector('.job-card');
    
    // Get all job listings data in one go
    const jobListings = await this.page.evaluate(() => {
      return Array.from(document.querySelectorAll('.job-card')).map(element => {
        // Title and URL
        const titleElement = element.querySelector('.card-header a');
        const title = titleElement?.querySelector('span')?.textContent?.trim() || '';
        const jobUrl = titleElement?.href || '';
        
        // Job posting and closing date
        const dateText = element.querySelector('.card-body p')?.textContent?.trim() || '';
        const [postingDate, closingDate] = dateText.replace('Job posting: ', '').replace('Closing date: ', '').split(' - ');
        
        // Categories
        const categories = Array.from(element.querySelectorAll('.nsw-tertiary-blue span'))
          .map(span => span.textContent?.trim())
          .filter(text => text && !text.includes('\n'));
        
        // Location
        const locations = Array.from(element.querySelectorAll('.nsw-col p:nth-child(3) span'))
          .map(span => span.textContent?.trim())
          .filter(text => text && text !== '');
        
        // Department
        const department = element.querySelector('.job-search-result-right h2')?.textContent?.trim() || '';
        
        // Job Type
        const jobType = element.querySelector('.job-search-result-right p span')?.textContent?.trim() || '';
        
        // Job ID
        const jobId = element.querySelector('.job-search-result-ref-no')?.textContent?.trim() || '';
        
        // Description snippet
        const description = element.querySelector('.nsw-col p:nth-child(4)')?.textContent?.trim() || '';
        
        return {
          title,
          postingDate,
          closingDate,
          categories,
          locations,
          department,
          jobType,
          jobId,
          jobUrl,
          description
        };
      });
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
        console.log(chalk.cyan(`Fetching details for job ID: ${jobInfo.jobId}`));
        
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
  }

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
      await detailPage.waitForSelector('.wrap-jobdetail');

      const jobDetails = await detailPage.evaluate(() => {
        // Get basic job information from the summary table
        const getSummaryValue = (label) => {
          const row = Array.from(document.querySelectorAll('.job-summary tr'))
            .find(row => row.querySelector('td b')?.textContent?.trim().includes(label));
          return row?.querySelectorAll('td')[1]?.textContent?.trim() || '';
        };

        // Get the full job description
        const description = document.querySelector('.job-detail-des')?.innerHTML?.trim() || '';
        
        // Get organization details
        const organization = getSummaryValue('Organisation / Entity:');
        
        // Get job category
        const category = getSummaryValue('Job category:');
        
        // Get location
        const location = getSummaryValue('Job location:');
        
        // Get work type
        const workType = getSummaryValue('Work type:');
        
        // Get remuneration
        const remuneration = getSummaryValue('Total remuneration package:');
        
        // Get closing date and time
        const closingDateTime = getSummaryValue('Closing date:');

        // Get contact information from the description
        const contactInfo = {
          name: '',
          email: '',
          phone: ''
        };

        // Extract contact details from description
        const descriptionText = document.querySelector('.job-detail-des')?.textContent || '';
        
        // Look for email addresses
        const emailMatch = descriptionText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
        if (emailMatch) {
          contactInfo.email = emailMatch[0];
        }

        // Look for phone numbers
        const phoneMatch = descriptionText.match(/\b\d{4}\s?\d{3}\s?\d{3}\b|\b\d{2}\s?\d{4}\s?\d{4}\b/);
        if (phoneMatch) {
          contactInfo.phone = phoneMatch[0];
        }

        // Look for contact name - usually near email or phone
        const contactNameMatch = descriptionText.match(/contact\s+([A-Z][a-z]+\s+[A-Z][a-z]+)/i);
        if (contactNameMatch) {
          contactInfo.name = contactNameMatch[1];
        }

        // Get related jobs count if available
        const relatedJobsMatch = document.querySelector('.callout__content')?.textContent.match(/currently\s+(\d+)\s+jobs/);
        const relatedJobs = relatedJobsMatch ? parseInt(relatedJobsMatch[1]) : 0;

        return {
          organization,
          category,
          location,
          workType,
          remuneration,
          closingDateTime,
          description,
          contactInfo,
          relatedJobs,
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