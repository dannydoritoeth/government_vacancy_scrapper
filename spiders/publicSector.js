import puppeteer from "puppeteer";
import settings from "../settings.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import chalk from "chalk";


/**
 * @description scrapes latest jobs advertised in public sector
 * by the Governement.
 */
export class PublicJobSpider {
  #name = "public jobs";
  #allowedDomains = [
    "https://iworkfor.nsw.gov.au/jobs/all-keywords/all-agencies/department-of-climate-change,-energy,-the-environment-and-water-/all-categories/all-locations/all-worktypes?agenciesid=9116&sortby=RelevanceDesc&pagesize=100"
  ];
  constructor() {
    this.browser = null;
    this.page = null;
  }

  /**
   * @description Set's up puppeteer broswer settings.
   */
  async launch() {
    console.log(chalk.bold.magenta(`"${this.#name}" spider launched.`));
    try {
      /**
       * @description Browser instance.
       */
      this.browser = await puppeteer.launch(settings);

      /**
       * @description Page object.
       */
      this.page = await this.browser.newPage();
      await this.#crawl();
    } catch (error) {
      console.log(chalk.red(error));
    }
  }
  /**
   * @description Initiates crawling processes & procedures.
   */
  async #crawl() {
    console.log(chalk.bold.magenta(`"${this.#name}" spider crawling.`));
    try {
      if (this.page) {
        // wait 1 minute by default for page.waitNavigation().
        this.page.setDefaultNavigationTimeout(200000);
        await this.page.goto(this.#allowedDomains[0]);
        console.log("loading website to to crawled.");
        // await this.page.waitForNetworkIdle()
        // const subscriptionModal = await this.page.$(".modalpop_overlay");

        // const modalVisible = await subscriptionModal.isIntersectingViewport();

        // if (modalVisible) {
        //   const subscriptionModalCloseButton = await this.page.$(
        //     ".close_modal"
        //   );

        //   subscriptionModalCloseButton.click();
        // }

        const menu = await this.page.$('*[aria-label="Menu"]');
        menu?.click();
        const elements = await this.page.$$(
          "ul li.wsite-menu-item-wrap a.wsite-menu-item"
        );
        let targetElement = null;
        for (const element of elements) {
          const textContent = await this.page.evaluate(
            (elem) => elem.textContent.toLowerCase().trim(),
            element
          );
          textContent.includes("updates") && (targetElement = element);
        }
        if (targetElement) {
          await targetElement.click();
          await this.#latestUpdates(this.page);
        }
      }
    } catch (err) {
      await this.#terminate();

      const errors = [
        "net::ERR_TIMED_OUT at https://www.govpage.co.za/",
        "Node is either not clickable or not an HTMLElement",
        "Navigation timeout of 100000 ms exceeded",
        "Cannot read properties of null (reading 'isIntersectingViewport')",
      ];

      for (const error of errors) {
        if (err.message.includes(error)) {
          fs.writeFile(
            this.#databasePath(`Error at ${this.#date("timestamp")}`, "errors"),
            JSON.stringify(
              {
                text: error,
                date: this.#date("date"),
              },
              null,
              4
            ),
            (error) =>
              error
                ? console.log(error.message)
                : console.log(
                    `Error log: ${this.#date(
                      "timestamp"
                    )}.json save to database`
                  )
          );
          console.log(chalk.yellowBright(`"${this.#name}" spider restarting.`));
          console.clear();
          await this.launch();
        }
      }
    }
  }
  /***
   * @param {Object} page
   * @description Get's currenly advertised government jobs for the current day.
   */
  async #latestUpdates(page) {
    console.log(chalk.bold.yellow("searching for latest government updates."));
    try {
      const updates = async () => {
        if (page.url().includes(this.#allowedDomains[1])) {
          clearInterval(intervalId);

          const currentDate = this.#date("date")
            .toUpperCase()
            .replaceAll("-", " ");

         await page.waitForSelector(".blog-title-link");

          const elementHandles = await page.$$(".blog-title-link");

          const targetHandle = await elementHandles.reduce(
            async (targetHandle, elementHandle) => {
              const textContent = await page.evaluate(
                (elem) => elem.textContent,
                elementHandle
              );
              if (textContent.includes(currentDate)) {
                targetHandle = elementHandle;
                return targetHandle;
              }
              return targetHandle;
            },
            null
          );

          if (targetHandle) {
            await targetHandle?.click();

            await this.#advertLinks(page);
          } else {
            fs.writeFile(
              this.#databasePath(this.#date("date")),
              JSON.stringify(
                {
                  text: "No job posts for today",
                  date: this.#date("date"),
                },
                null,
                4
              ),
              (error) =>
                error
                  ? console.log(error.message)
                  : console.log(`${this.#date("date")}.json save to database`)
            );
            await this.#terminate();
          }
        }
      };

      const intervalId = setInterval(() => {
        updates();
      }, 5000);
    } catch (err) {
      await this.#terminate();

      console.clear();
      fs.writeFile(
        this.#databasePath(`Error at ${this.#date("timestamp")}`, "errors"),
        JSON.stringify(
          {
            text: err.message,
            date: this.#date("date"),
          },
          null,
          4
        ),
        (error) =>
          error
            ? console.log(error.message)
            : console.log(
                `Error log: ${this.#date("timestamp")}.json save to database`
              )
      );
    }
  }
  async #advertLinks(page) {
    console.log(chalk.bold.yellow("searching for advert post links."));
    try {
      const advertList = async () => {
        const date = this.#date("date").toLowerCase();

        if (page.url().includes(date)) {
          const posts = {
            list: [],
            total: 0,
          };

          const elementHandles = await page.$$("[id^='blog-post-'] a");

          if (elementHandles.length) {
            clearInterval(intervalId);
            console.log(
              chalk.bold.cyanBright(
                `found some posts, number of detected posts is: ${elementHandles.length}`
              )
            );
            for (let i = 0; i < elementHandles.length; i++) {
              const elementHandle = elementHandles[i];

              const elemObject = await page.evaluate(
                (elem) => ({
                  text: elem.textContent.trim(),
                  sourceLink: elem.href,
                }),
                elementHandle
              );

              i == 0
                ? (posts["date"] = elemObject.text)
                : (() => {
                    if (elemObject.text.length) {
                      posts["list"].push(elemObject);
                      posts.total++;
                    }
                  })();
            }

            if (posts.total) {
              fs.writeFile(
                this.#databasePath(posts.date),
                JSON.stringify(posts, null, 4),
                (error) =>
                  error
                    ? console.log(error.message)
                    : (async () => {
                        console.log(
                          chalk.greenBright(
                            `Data written to ${posts.date}.json file successfully. `
                          )
                        );

                        await this.#terminate();
                      })()
              );
            }
          } else {
            console.log(
              `searching for posts as of right now, number of  detected posts is: ${elementHandles.length}`
            );
          }
        }
      };
      const intervalId = setInterval(() => {
        advertList();
      }, 5000);
    } catch (err) {
      await this.#terminate();

      const errors = [
        "Navigation failed because browser has disconnected!",
        "PID",
        "Target closed",
      ];
      for (const error of errors) {
        if (err.message.includes(error)) {
          console.clear();

          fs.writeFile(
            this.#databasePath(`Error at ${this.#date("timestamp")}`, "errors"),
            JSON.stringify(
              {
                text: error,
                date: this.#date("date"),
              },
              null,
              4
            ),
            (error) =>
              error
                ? console.log(error.message)
                : console.log(
                    `Error log: ${this.#date(
                      "timestamp"
                    )}.json save to database`
                  )
          );
          console.log(`"${this.#name}" spider restarting.`);
          console.clear();
          await this.launch();
        } else {
          fs.writeFile(
            this.#databasePath(`Error at ${this.#date("timestamp")}`, "errors"),
            JSON.stringify(
              {
                text: err,
                date: this.#date("date"),
              },
              null,
              4
            ),
            (error) =>
              error
                ? console.log(error.message)
                : console.log(
                    `Error log: ${this.#date(
                      "timestamp"
                    )}.json save to database`
                  )
          );
        }
      }
    }
  }
  /***
   * @description close Puppeteer Web Scraper.
   */
  async #terminate() {
    try {
      if (this.browser && this.page) {
        await this.page.goto("about:blank");
        await this.browser.close();
      }
    } catch (err) {
      // console.log("Problem : ", err);
    }
  }
  /**
   * @param {String} file
   * @returns String: file path
   */
  #databasePath(file = this.#date("date"), folder = "database") {
    const currentFilePath = fileURLToPath(import.meta.url);
    const directoryPath = path.dirname(currentFilePath);
    return path.join(directoryPath, "..", folder, `${file}.json`);
  }
  /***
   * @param {string} [type=""]
   * @description Get's  the current date and time.
   * @returns date string
   *
   */
  #date(type = "") {
    try {
      const pad = (num) => num.toString().padStart(2, "0"),
        date = new Date(),
        year = date.getFullYear(),
        month = date.toLocaleString("default", { month: "long" }),
        day = date.getDate(),
        hour = date.getHours(),
        minute = date.getMinutes(),
        second = date.getSeconds();

      const currentDate = `${day}-${pad(month)}-${pad(year)}`;
      const currentTime = ` ${pad(hour)}:${pad(minute)}:${pad(second)}`;
      switch (type.trim().toLowerCase()) {
        case "date":
          return currentDate;
        case "time":
          return currentTime;
        case "timestamp":
          return `${year}${pad(month)}${pad(day)}${pad(hour)}${pad(
            minute
          )}${pad(second)}`;

        default:
          return {
            date: currentDate,
            time: currentTime,
          };
      }
    } catch (error) {
      console.log(error.message);
    }
  }
}
