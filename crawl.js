import { NSWJobSpider } from "./spiders/nswGovJobs.js";
import chalk from "chalk";

/**
 * @description Initiates web scraping.
 */
async function main() {
  try {
    console.log(chalk.bold.green("Crawler initiated."));
    const spider = new NSWJobSpider();
    await spider.launch();
  } catch (error) {
    console.log(error);
  }
}

main();
