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

    // Function to request metadata
    async function requestMetadata(url, metaDataEndpoint, env) {
      try {
        const trimmedUrl = url.endsWith("/") ? url.slice(0, -1) : url;
        const id = trimmedUrl.split("/").pop();
        const finalEndpoint = metaDataEndpoint.replace(/{[^}]+}/, id);

        const metaDataResponse = await fetch(finalEndpoint, {
          headers: {
            "apikey": env.SUPABASE_KEY,
            "Authorization": `Bearer ${env.SUPABASE_KEY}`,
            "Content-Type": "application/json"
          }
        });

        if (!metaDataResponse.ok) {
          console.error("Failed to fetch metadata. Status:", metaDataResponse.status);
          return {};
        }

        const responseJson = await metaDataResponse.json();
        if (responseJson && responseJson.source && responseJson.source["0"]) {
          const metadata = responseJson.source["0"];

          // OPTIONAL: Fix image field if needed
          if (metadata.image && !metadata.image.startsWith('http')) {
            metadata.image = `https://api.griiingo.com/storage/v1/object/public/public-user-content/companies-photos/${metadata.image}`;
          }

          return metadata;
        } else {
          console.warn("Metadata response was empty or invalid", responseJson);
          return {};
        }
      } catch (error) {
        console.error("Error fetching metadata:", error);
        return {};
      }
    }

    // Handle dynamic page requests
    const patternConfig = getPatternConfig(url.pathname);
    if (patternConfig) {
      console.log("Dynamic page detected:", url.pathname);

      // Fetch the source page content
      let source = await fetch(`${domainSource}${url.pathname}`);

      // Remove "X-Robots-Tag" from the headers
      const sourceHeaders = new Headers(source.headers);
      sourceHeaders.delete('X-Robots-Tag');
      source = new Response(source.body, {
        status: source.status,
        headers: sourceHeaders
      });

      const metadata = await requestMetadata(url.pathname, patternConfig.metaDataEndpoint, env);
      console.log("Metadata fetched:", metadata);

      const customHeaderHandler = new CustomHeaderHandler(metadata);

      return new HTMLRewriter()
        .on('*', customHeaderHandler)
        .transform(source);

    // Handle page data requests for the WeWeb app
    } else if (isPageData(url.pathname)) {
      console.log("Page data detected:", url.pathname);
      console.log("Referer:", referer);

      const sourceResponse = await fetch(`${domainSource}${url.pathname}`);
      let sourceData = await sourceResponse.json();

      let pathname = referer;
      pathname = pathname ? pathname + (pathname.endsWith('/') ? '' : '/') : null;
      if (pathname !== null) {
        const patternConfigForPageData = getPatternConfig(pathname);
        if (patternConfigForPageData) {
          const metadata = await requestMetadata(pathname, patternConfigForPageData.metaDataEndpoint, env);
          console.log("Metadata fetched:", metadata);

          sourceData.page = sourceData.page || {};
          sourceData.page.title = sourceData.page.title || {};
          sourceData.page.meta = sourceData.page.meta || {};
          sourceData.page.meta.desc = sourceData.page.meta.desc || {};
          sourceData.page.meta.keywords = sourceData.page.meta.keywords || {};
          sourceData.page.socialTitle = sourceData.page.socialTitle || {};
          sourceData.page.socialDesc = sourceData.page.socialDesc || {};

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

          console.log("Returning modified file:", JSON.stringify(sourceData));
          return new Response(JSON.stringify(sourceData), {
            headers: { 'Content-Type': 'application/json' }
          });
        }
      }
    }

    // Fallback: fetch and return original content
    console.log("Fetching original content for:", url.pathname);
    const sourceUrl = new URL(`${domainSource}${url.pathname}`);
    const sourceRequest = new Request(sourceUrl, request);
    const sourceResponse = await fetch(sourceRequest);

    const modifiedHeaders = new Headers(sourceResponse.headers);
    modifiedHeaders.delete('X-Robots-Tag');

    return new Response(sourceResponse.body, {
      status: sourceResponse.status,
      headers: modifiedHeaders,
    });
  }
};

// CustomHeaderHandler class
class CustomHeaderHandler {
  constructor(metadata) {
    this.metadata = metadata;
  }

  element(element) {
    const metadataMap = {
      "title": this.metadata.title,
      "description": this.metadata.description,
      "keywords": this.metadata.keywords,
      "image": this.metadata.image,
      "og:title": this.metadata.title,
      "og:description": this.metadata.description,
      "og:image": this.metadata.image,
      "twitter:title": this.metadata.title,
      "twitter:description": this.metadata.description,
      "twitter:card": "summary_large_image"
    };

    if (element.tagName == "title") {
      console.log('Replacing title tag content');
      element.setInnerContent(this.metadata.title || '');
    }

    if (element.tagName == "meta") {
      const name = element.getAttribute("name");
      const property = element.getAttribute("property");
      const itemprop = element.getAttribute("itemprop");

      if (name && metadataMap[name]) {
        element.setAttribute("content", metadataMap[name]);
      }
      if (property && metadataMap[property]) {
        element.setAttribute("content", metadataMap[property]);
      }
      if (itemprop && metadataMap[itemprop]) {
        element.setAttribute("content", metadataMap[itemprop]);
      }

      if (name === "robots" && element.getAttribute("content") === "noindex") {
        console.log('Removing noindex tag');
        element.remove();
      }
    }
  }
}
