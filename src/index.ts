import { config } from '../config.js';

const DEFAULT_METADATA = {
  title: "Griiingo",
  description: "Conectamos imigrantes e turistas à comunidade brasileira. Encontre empresas, serviços, eventos e empregos de brasileiros, fora do Brasil.",
  keywords: "empresas brasileiras, serviços brasileiros, eventos brasileiros, empregos brasileiros",
  image: "https://api.griiingo.com/storage/v1/object/public/public-griiingo-content/general/griiingo-profile.png"
};

function getPatternConfig(pathname) {
  for (const patternConfig of config.patterns) {
    const regex = new RegExp(patternConfig.pattern);
    if (regex.test(pathname)) return patternConfig;
  }
  return null;
}

function isPageData(pathname) {
  const pattern = /\/public\/data\/[a-f0-9-]{36}\.json/;
  return pattern.test(pathname);
}

async function requestMetadata(slug, metaDataEndpoint, env) {
  try {
    const finalEndpoint = `${metaDataEndpoint}?slug=eq.${slug}&select=title,description,keywords,image`;
    const response = await fetch(finalEndpoint, {
      headers: {
        apikey: env.SUPABASE_KEY,
        Authorization: `Bearer ${env.SUPABASE_KEY}`,
        "Content-Type": "application/json"
      }
    });

    if (!response.ok) {
      console.error(`[Metadata] Failed with status ${response.status}`);
      return DEFAULT_METADATA;
    }

    const data = await response.json();

    if (Array.isArray(data) && data.length > 0) {
      const metadata = data[0];

      if (metadata.image && !metadata.image.startsWith("http")) {
        metadata.image = `https://api.griiingo.com/storage/v1/object/public/public-user-content/companies-photos/${metadata.image}`;
      }

      console.log("[Metadata] Found metadata for slug:", slug, metadata);
      return metadata;
    }

    console.warn("[Metadata] No result for slug:", slug);
    return DEFAULT_METADATA;

  } catch (err) {
    console.error("[Metadata] Fetch error:", err);
    return DEFAULT_METADATA;
  }
}

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

    if (element.tagName === "title") {
      element.setInnerContent(this.metadata.title);
    }

    if (element.tagName === "meta") {
      const name = element.getAttribute("name");
      const property = element.getAttribute("property");
      const itemprop = element.getAttribute("itemprop");

      if (metadataMap[name]) element.setAttribute("content", metadataMap[name]);
      if (metadataMap[property]) element.setAttribute("content", metadataMap[property]);

      if (itemprop && metadataMap[itemprop]) {
        element.setAttribute("content", metadataMap[itemprop]);
      }

      if (name === "robots") {
        element.setAttribute("content", "index, follow");
      }
    }
  }
}

export default {
  async fetch(request, env, ctx) {
    if (request.headers.get("X-Bypass-Worker") === "true") {
      return fetch(request);
    }

    const url = new URL(request.url);
    const pathname = url.pathname;
    const patternConfig = getPatternConfig(pathname);
    const isData = isPageData(pathname);

    try {
      // Handle dynamic HTML metadata injection
      if (patternConfig && !isData) {
        const slug = pathname.split("/").filter(Boolean).pop(); // Extract "tierdigital"
        const metadata = await requestMetadata(slug, patternConfig.metaDataEndpoint, env);

        const sourceResponse = await fetch(`${config.domainSource}${pathname}`, {
          headers: {
            ...Object.fromEntries(request.headers),
            "X-Bypass-Worker": "true"
          }
        });

        const headers = new Headers(sourceResponse.headers);
        headers.delete("X-Robots-Tag");

        return new HTMLRewriter()
          .on("*", new CustomHeaderHandler(metadata))
          .transform(new Response(sourceResponse.body, { status: sourceResponse.status, headers }));
      }

      // Handle JSON page data (WeWeb)
      if (isData) {
        const referer = request.headers.get("Referer");
        const refPath = referer ? new URL(referer).pathname : null;
        const patternConfig = getPatternConfig(refPath);

        if (patternConfig) {
          const slug = refPath.split("/").filter(Boolean).pop();
          const metadata = await requestMetadata(slug, patternConfig.metaDataEndpoint, env);
          const sourceResponse = await fetch(`${config.domainSource}${pathname}`, {
            headers: { "X-Bypass-Worker": "true" }
          });

          const json = await sourceResponse.json();
          json.page = json.page || {};
          json.page.title = { en: metadata.title };
          json.page.meta = {
            desc: { en: metadata.description },
            keywords: { en: metadata.keywords }
          };
          json.page.socialTitle = { en: metadata.title };
          json.page.socialDesc = { en: metadata.description };
          json.page.metaImage = metadata.image;

          return new Response(JSON.stringify(json), {
            headers: { "Content-Type": "application/json" }
          });
        }
      }

      // Fallback
      const fallbackRes = await fetch(`${config.domainSource}${pathname}`, {
        headers: {
          ...Object.fromEntries(request.headers),
          "X-Bypass-Worker": "true"
        }
      });

      const headers = new Headers(fallbackRes.headers);
      headers.delete("X-Robots-Tag");

      return new HTMLRewriter()
        .on("*", new CustomHeaderHandler(DEFAULT_METADATA))
        .transform(new Response(fallbackRes.body, { status: fallbackRes.status, headers }));

    } catch (err) {
      console.error("[Worker] Global error:", err);
      const fallback = new Response("Default content", { status: 200, headers: { "Content-Type": "text/html" } });
      return new HTMLRewriter()
        .on("*", new CustomHeaderHandler(DEFAULT_METADATA))
        .transform(fallback);
    }
  }
};
