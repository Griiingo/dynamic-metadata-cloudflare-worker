# Cloudflare Worker for Dynamic Metadata in WeWeb SPA

This project demonstrates a Cloudflare Worker that acts as a reverse proxy server to dynamically fetch and modify metadata for WeWeb Single Page Applications (SPA). This solution is particularly useful for dynamic pages with URL parameters, such as event pages, where each page requires unique metadata.

## Use Case

When creating dynamic pages in WeWeb, such as www.myapp.com/events/40, all pages share the same metadata configured in the editor. However, you may need different metadata (title, description, keywords, and thumbnails) for each page based on the URL parameter (e.g., event ID). Since WeWeb apps are front-end only (SPA), we need a "backend module" to handle dynamic metadata.

This Cloudflare Worker serves as a reverse proxy server. It intercepts requests for dynamic pages, fetches the specific metadata from an endpoint, and updates the HTML file before sending it back to the browser. This effectively enables server-side rendering of metadata for better SEO and social media sharing.

## Get Started

### Renaming the Worker

You can change the name of your worker in the `wrangler.toml` file. Locate the `name` field and modify it as needed. For example:

```toml
name = "new-name-for-my-worker"
main = "src/index.ts"
compatibility_date = "2024-04-19"
compatibility_flags = ["nodejs_compat"]
```

### Updating the Config File

In the config.js file, update the WeWeb app link, the endpoint that returns metadata, and the patterns for the dynamic pages.

```javascript
export const config = {
  domainSource: "https://f69a71f6-9fd8-443b-a040-78beb5d404d4.weweb-preview.io", // Your WeWeb app preview link
  patterns: [
    {
      pattern: "/event/[^/]+",
      metaDataEndpoint: "https://xeo6-2sgh-ehgj.n7.xano.io/api:8wD10mRd/event/{id}/meta"
    },
    {
      pattern: "/team/profile/[^/]+",
      metaDataEndpoint: "https://xeo6-2sgh-ehgj.n7.xano.io/api:LjwxezTv/team/profile/{profile_id}/meta"
    }
    // Add more patterns and their metadata endpoints as needed
  ]
};

```

- domainSource: The base URL for fetching the original content.
- metaDataEndpoint: The API endpoint for fetching metadata. The endpoint should return an object like this:
```json
{
  "title": "Festival",
  "description": "Test Our annual festival is back, promising an array of activities for every age and interest. From thrilling amusement rides and live performances to a marketplace brimming with handcrafted goods, there's joy and discovery around every corner. Learn from artisans during workshops, indulge in diverse culinary delights, and immerse yourself in the festive atmosphere that celebrates our community's spirit.",
  "image": "https://xeo6-2sgh-ehgj.n7.xano.io/vault/UUJkO96O/eQbZuT4a7I7Iks60ScIyEXlKZ-s/u16buw../hanny-naibaho-aWXVxy8BSzc-unsplash.jpg",
  "keywords": "festival music live"
}
```
- patterns: Regular expressions used to identify dynamic pages and page data. For example, if the dynamic page has a URL like www.myapp.com/event/40, it should be "/event/[^/]+". If the link is www.myapp.com/article/name-of-the-article, it should be "/article/[^/]+".

## Deployment
To deploy the worker, use the Cloudflare Wrangler CLI. Ensure you have the Cloudflare account and Wrangler CLI set up, then run:

```sh
npm run deploy
```

Or you can click the button below:

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/WeWeb-Public/dynamic-metadata-with-cloudflare-worker)


## Worker Script
The main logic of the worker is contained in index.js. This script fetches and modifies web pages based on the URL patterns defined in the configuration file.

## Fetch Event Handler
The fetch event handler processes incoming requests, checks if the request URL matches specific patterns, and performs the necessary modifications.

```javascript
import { config } from '../config.js';

export default {
  async fetch(request, env, ctx) {
    // Extracting configuration values
    const domainSource = config.domainSource;
    const patterns = config.patterns;

    console.log("Worker started");

    // Parse the request URL
    const url = new URL(request.url);
    const referer = request.headers.get('Referer');

    // Function to get the pattern configuration that matches the URL
    function getPatternConfig(url) {
      for (const patternConfig of patterns) {
        const regex = new RegExp(patternConfig.pattern);
        let pathname = url + (url.endsWith('/') ? '' : '/');
        if (regex.test(pathname)) {
          return patternConfig;
        }
      }
      return null;
    }

    // Function to check if the URL matches the page data pattern (For the WeWeb app)
    function isPageData(url) {
      const pattern = /\/public\/data\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.json/;
      return pattern.test(url);
    }

    async function requestMetadata(url, metaDataEndpoint) {
      // Remove any trailing slash from the URL
      const trimmedUrl = url.endsWith('/') ? url.slice(0, -1) : url;
    
      // Split the trimmed URL by '/' and get the last part: The id
      const parts = trimmedUrl.split('/');
      const id = parts[parts.length - 1];
    
      // Replace the placeholder in metaDataEndpoint with the actual id
      const placeholderPattern = /{([^}]+)}/;
      const metaDataEndpointWithId = metaDataEndpoint.replace(placeholderPattern, id);
    
      // Fetch metadata from the API endpoint
      const metaDataResponse = await fetch(metaDataEndpointWithId);
      const metadata = await metaDataResponse.json();
      return metadata;
    }

    // Handle dynamic page requests
    const patternConfig = getPatternConfig(url.pathname);
    if (patternConfig) {
      console.log("Dynamic page detected:", url.pathname);

      // Fetch the source page content
      let source = await fetch(`${domainSource}${url.pathname}`);

      const metadata = await requestMetadata(url.pathname, patternConfig.metaDataEndpoint);
      console.log("Metadata fetched:", metadata);

      // Create a custom header handler with the fetched metadata
      const customHeaderHandler = new CustomHeaderHandler(metadata);

      // Transform the source HTML with the custom headers
      return new HTMLRewriter()
        .on('*', customHeaderHandler)
        .transform(source);

    // Handle page data requests for the WeWeb app
    } else if (isPageData(url.pathname)) {
        console.log("Page data detected:", url.pathname);
        console.log("Referer:", referer);

      // Fetch the source data content
      const sourceResponse = await fetch(`${domainSource}${url.pathname}`);
      let sourceData = await sourceResponse.json();

      let pathname = referer;
      pathname = pathname ? pathname + (pathname.endsWith('/') ? '' : '/') : null;
      if (pathname !== null) {
        const patternConfigForPageData = getPatternConfig(pathname);
        if (patternConfigForPageData) {
          const metadata = await requestMetadata(pathname, patternConfigForPageData.metaDataEndpoint);
          console.log("Metadata fetched:", metadata);

          // Ensure nested objects exist in the source data
          sourceData.page = sourceData.page || {};
          sourceData.page.title = sourceData.page.title || {};
          sourceData.page.meta = sourceData.page.meta || {};
          sourceData.page.meta.desc = sourceData.page.meta.desc || {};
          sourceData.page.meta.keywords = sourceData.page.meta.keywords || {};
          sourceData.page.socialTitle = sourceData.page.socialTitle || {};
          sourceData.page.socialDesc = sourceData.page.socialDesc || {};

          // Update source data with the fetched metadata
          if (metadata.title) {
            sourceData.page.title.en = metadata.title;
            sourceData.page.socialTitle.en = metadata.title;
          }
          if (metadata.description) {
            sourceData.page.meta.desc.en = metadata.description;
            sourceData.page.socialDesc.en = metadata.description;
          }
          if (metadata.image) {
            sourceData.page.metaImage = metadata.image;
          }
          if (metadata.keywords) {
            sourceData.page.meta.keywords.en = metadata.keywords;
          }

          console.log("returning file: ", JSON.stringify(sourceData));
          // Return the modified JSON object
          return new Response(JSON.stringify(sourceData), {
            headers: { 'Content-Type': 'application/json' }
          });
        }
      }
    }

    // If the URL does not match any patterns, fetch and return the original content
    console.log("Fetching original content for:", url.pathname);
    const sourceUrl = new URL(`${domainSource}${url.pathname}`);
    const sourceRequest = new Request(sourceUrl, request);
    const sourceResponse = await fetch(sourceRequest);

    return sourceResponse;
  }
};

// CustomHeaderHandler class to modify HTML content based on metadata
class CustomHeaderHandler {
  constructor(metadata) {
    this.metadata = metadata;
  }

  element(element) {
    // Replace the <title> tag content
    if (element.tagName == "title") {
      console.log('Replacing title tag content');
      element.setInnerContent(this.metadata.title);
    }
    // Replace meta tags content
    if (element.tagName == "meta") {
      const name = element.getAttribute("name");
      switch (name) {
        case "title":
          element.setAttribute("content", this.metadata.title);
          break;
        case "description":
          element.setAttribute("content", this.metadata.description);
          break;
        case "image":
          element.setAttribute("content", this.metadata.image);
          break;
        case "keywords":
          element.setAttribute("content", this.metadata.keywords);
          break;
        case "twitter:title":
          element.setAttribute("content", this.metadata.title);
          break;
        case "twitter:description":
          element.setAttribute("content", this.metadata.description);
          break;
      }

      const itemprop = element.getAttribute("itemprop");
      switch (itemprop) {
        case "name":
          element.setAttribute("content", this.metadata.title);
          break;
        case "description":
          element.setAttribute("content", this.metadata.description);
          break;
        case "image":
          element.setAttribute("content", this.metadata.image);
          break;
      }

      const type = element.getAttribute("property");
      switch (type) {
        case "og:title":
          console.log('Replacing og:title');
          element.setAttribute("content", this.metadata.title);
          break;
        case "og:description":
          console.log('Replacing og:description');
          element.setAttribute("content", this.metadata.description);
          break;
        case "og:image":
          console.log('Replacing og:image');
          element.setAttribute("content", this.metadata.image);
          break;
      }
    }
  }
}
```

### Explanation
1. Configuration File (config.js):
- Contains configuration settings such as domainSource and an array of patterns for dynamic pages.
- Each pattern includes a regex to match the URL and an endpoint to fetch metadata.

2. Worker Script (index.js):
- Imports Configuration: Imports settings from config.js.
- Request Handling:
  - Parses the request URL.
  - Determines whether the URL matches dynamicPage or pageData patterns using regex.
- Dynamic Page Handling:
  - If the request matches a dynamic page pattern, fetches the original page and metadata.
  - Uses `HTMLRewriter` to modify the HTML content based on the fetched metadata.
- Page Data Handling:
  - If the request matches a page data pattern, fetches the source data and metadata.
  - Updates the source data with the fetched metadata and returns the modified JSON.
- Default Handling:
  -If no patterns match, fetches and returns the original content.
- Custom Header Handler:
  - A class that uses HTMLRewriter to replace the content of <title> and <meta> tags in the HTML based on the fetched metadata.

3. Error Handling:
- Added checks to ensure url.searchParams and other potentially undefined objects are handled properly.
- Uses console.log statements to provide useful debugging information and track the flow of execution.

## Contributing
Feel free to fork this repository and submit

