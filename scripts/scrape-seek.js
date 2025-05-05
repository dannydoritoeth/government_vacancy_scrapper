import { SeekJobSpider } from "../spiders/seekJobs.js";
import chalk from "chalk";

/**
 * @description Runs the Seek Jobs spider
 */
async function scrapeSeek() {
    try {
        console.log(chalk.bold.green("Starting Seek Jobs spider..."));
        const spider = new SeekJobSpider();
        await spider.launch();
        console.log(chalk.green("\nSeek Jobs spider completed successfully!"));
    } catch (error) {
        console.error(chalk.red("Error running spider:", error));
        process.exit(1);
    }
}

// Run Seek spider
scrapeSeek(); 