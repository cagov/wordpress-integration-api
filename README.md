# Wordpress content integration service for Covid19.ca.gov
Using the WordPress API, deploys posts to a target GitHub location; specifically for the [covid19.ca.gov](https://covid19.ca.gov) website.

## Features
- Pushes post content updates to a GitHub repository (Add/Update/Delete).
- Submits posts with the `translate` tag to the AvantPage endpoint for human translation.
- Temporary execution log.
- Slack error reporting.

## _NOT_ included
- Does not include WordPress image support.
- Does not include support for pages or any other non-post content.

## Usage

The service can be run directly by pressing a form button on its running function site, or as the target of a POST request.

### WordPress post tags used
| Tag | Description |
| :-- | :-- |
| **`do-not-deploy`** | Ignores the post when processing.|
| **`staging-only`** | Ignores the post when the target is the `master` branch only.|
| **`translate`** | Changes to the post are submitted to the remote translation service. |
| **`translate-priority`** | Combined with **`translate`**, translation submitions will be marked `priority:true`. |
| **`table-data`** | Alternatively creates `JSON` file output using any tables defined in the post.  |
| **`fragment`** | Renders the `HTML` post output without any `YAML` Front Matter Data. |
| **`do-not-crawl`** | Returns `addtositemap: false` in the Front Matter Data |
| **`lang-`_XX_** | **Deprecated**.  Was used to identify a page as a specific language.  No effect. |

### Front Matter output mapping
| Attribute | Description |
| :-- | :-- |
| **`layout`** | Always "**_page.njk_**". |
| **`title`** | From API - `title.rendered`. |
| **`meta`** | From API - `excerpt.rendered` (`<p>` tags and `/n` removed). |
| **`author`** | Always "**_State of California_**". |
| **`publishdate`** | From API - `modified_gmt`.  |
| **`addtositemap`** | "**_true_**" unless **`do-not-crawl`** tag used. |
| **`tags`** | Array mapped to strings from API - `tags`.  |

### WordPress API endpoints required
| Tag | Purpose |
| :-- | :-- |
| **`/wp-json/wp/v2/categories`** | Unknown.  May have been used in the past instead of tags. - _Might not be needed anymore_. |
| **`/wp-json/wp/v2/tags`** | Used to match post tags to their ids. |
| **`/wp-json/wp/v2/posts`** | Used to retrieve post data. |

## Local Development

The project expects the Azure Functions SDK to be installed in order to run locally.

TODO: It would be great to have the project configured to run without the SDK and just use the VSCode debugger.


## Target GitHub location
- https://github.com/cagov/covid19/tree/master/pages/wordpress-posts

## Running Production Service
- https://fa-cdt-covid19-d-001.azurewebsites.net/WordPressService

## Source Github Repo
- https://github.com/cagov/wordpress-integration-api

# Translation pipline for covid19.ca.gov

The CA COVID19 website supports multiple translated languages.  To allow for this, a translation pipeline will be created that ensures continuous human translation as English language updates are made.

## Actors
- **ODI** - Office of Digital Innovation
- **AT** - ​Avantpage Translations

## Assumptions
- Notifications between services will not be authenticating.
- Content will be downloaded (GET) by services, rather than pushed to them.
- Content delivered to ODI will not be reviewed by ODI; it will be deployed to ODI production/staging environments immediately.

## Process
1. ODI content writers will author English versions in WordPress.
1. WordPress will send a POST to the `wordpress-integration-api` service when a post content change occures.  The content of the POST is ignored.
1. The `wordpress-integration-api` service will scan WordPress for post updates and sync content updates to GitHub.
1. The `wordpress-integration-api` will send a post payload to AT for any post updates that are tagged as `translate`. see [below](#post-payload-from-odi-to-at) for details.
1. AT will GET full page content directly from GitHub.
1. AT will perform translation work.
1. AT will create a GitHub Pull Request containing updated translation content.
   - The Pull Request will be labeled `Translated Content`
1. ODI will approve appropriately tagged Pull Requests via [CovidTranslationPrApproval](https://github.com/cagov/Cron/tree/master/CovidTranslationPrApproval), but only when they...
   - Have passed all their check runs.
   - Only contain content within the _pages/translated-posts_ folder.
   - Do not contain invalid characters.
1. GitHub will build and publish with updated translations.

### POST payload from ODI to AT
When `wordpress-integration-api` notifies AT that changes have occurred, the following JSON payload should be used.

| Property | Description |
| :-- | :-- |
| **`id`** | WordPress id of post. |
| **`slug`** | WordPres slug of post. |
| **`modified`** | GMT date/time of modification. |
| **`priority`** | Optional. `true` for a priority translation. |
| **`download_path`** | GitHub path to download HTML or JSON content. Example - _/master/pages/wordpress-posts/contracts.html_ |

#### Sample JSON Payload
```JSON
{
    "posts":
	[
		{
    		"id": 36,
    		"slug": "education",
    		"modified": "2020-04-27T23:14:07",
    		"download_path": "/master/pages/wordpress-posts/education.html",
		    "priority": true //Optional to indicate a priority translation
		}
	]
	,"test": 1  ///Optional to indicate a test request
}

```

## HTML Content requirements

Content aquired for translations could be in JSON or HTML format.

When the content is in HTML format, it is possible that the file could have 11ty Front Matter Data.  AT is expected to maintain the field names for Front Matter Data when performing translations, as well as class and variable names for HTML content.

### Example English content with Front Matter
```YAML
---
layout: "page.njk"
title: "Data and tools"
meta: "California has collected a wide range of data to inform its response to COVID-19."
author: "State of California"
publishdate: "2022-03-07T18:15:10Z"
tags: ["translate"]
addtositemap: true
---
```
```HTML
<p class="emphasized">California has collected a wide range of data to inform its response to COVID-19, and developed tools to help process and analyze that data. These are made available to everyone for transparency.</p>

<p class="h3">On this page:</p>
```
### Example translated to Simplified Chinese
```YAML
---
layout: "page.njk"
title: "数据及工具"
meta: "加州已经收集了大量数据，为应对COVID-19提供了信息。"
author: "State of California"
publishdate: "2022-03-07T18:15:10Z"
tags: ["translate"]
addtositemap: true
---
```
```HTML
<p class="emphasized">加州已经收集了大量数据，以发布应对COVID-19的信息，并开发了工具以协助处理并分析这些数据。为保证公开透明，所有人都可查看这些数据。</p>

<p class="h3">此页面包含的内容：</p>
```