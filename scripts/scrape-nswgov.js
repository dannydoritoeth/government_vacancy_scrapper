import { NSWJobSpider } from "../spiders/nswGovJobs.js";
import chalk from "chalk";

/**
 * @description Runs the NSW Government Jobs spider
 */
async function scrapeNSWGov() {
    try {
        console.log(chalk.bold.green("Starting NSW Government Jobs spider..."));
        const spider = new NSWJobSpider();
        await spider.launch();
        console.log(chalk.green("\nNSW Government Jobs spider completed successfully!"));
    } catch (error) {
        console.error(chalk.red("Error running spider:", error));
        process.exit(1);
    }
}

// Run NSW Gov spider
scrapeNSWGov(); 