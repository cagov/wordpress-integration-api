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
