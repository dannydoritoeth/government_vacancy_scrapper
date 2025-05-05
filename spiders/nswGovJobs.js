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

  constructor() {
    this.browser = null;
    this.page = null;
    this.pageSize = 25; // Default page size
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
    
    // Wait for job elements to load
    await this.page.waitForSelector('.job-card');
    
    // Get all job items
    const jobElements = await this.page.$$('.job-card');
    totalJobs = jobElements.length;
    
    console.log(chalk.cyan(`Found ${totalJobs} job listings to process...`));
    
    for (const jobElement of jobElements) {
      try {
        const job = await this.page.evaluate(element => {
          // Title
          const titleElement = element.querySelector('.card-header a span');
          const title = titleElement?.textContent?.trim() || '';
          
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
          
          // Job URL
          const jobUrl = element.querySelector('.card-header a')?.href || '';
          
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
        }, jobElement);
        
        jobs.push(job);
        successfulScrapes++;
        process.stdout.write(`\rProcessed: ${successfulScrapes}/${totalJobs} jobs`);
      } catch (error) {
        failedScrapes++;
        console.log(chalk.yellow(`\nError scraping job: ${error.message}`));
      }
    }
    
    console.log('\n');
    console.log(chalk.cyan('Job Processing Summary:'));
    console.log(chalk.green(`Successfully scraped: ${successfulScrapes} jobs`));
    console.log(chalk.yellow(`Failed to scrape: ${failedScrapes} jobs`));
    
    return jobs;
  }
} 