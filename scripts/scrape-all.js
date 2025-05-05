import { NSWJobSpider } from "../spiders/nswGovJobs.js";
import { SeekJobSpider } from "../spiders/seekJobs.js";
import chalk from "chalk";

/**
 * @description Runs all job spiders sequentially
 */
async function scrapeAll() {
    try {
        console.log(chalk.bold.green("Starting all job spiders..."));

        // Run NSW Government Jobs spider
        console.log(chalk.cyan("\nStarting NSW Government Jobs spider..."));
        const nswSpider = new NSWJobSpider();
        await nswSpider.launch();

        // Run Seek Jobs spider
        console.log(chalk.cyan("\nStarting Seek Jobs spider..."));
        const seekSpider = new SeekJobSpider();
        await seekSpider.launch();

        console.log(chalk.green("\nAll spiders completed successfully!"));
    } catch (error) {
        console.error(chalk.red("Error running spiders:", error));
        process.exit(1);
    }
}

// Run all spiders
scrapeAll(); 