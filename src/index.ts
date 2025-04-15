import { config } from '../config.js';

const DEFAULT_METADATA = {
  title: "Griiingo",
  description: "Conectamos imigrantes e turistas à comunidade brasileira. Encontre empresas, serviços, eventos e empregos de brasileiros, fora do Brasil.",
  keywords: "empresas brasileiras, serviços brasileiros, eventos brasileiros, empregos brasileiros",
  image: "https://api.griiingo.com/storage/v1/object/public/public-griiingo-content/general/griiingo-profile.png"
};

// Utilities
function getPatternConfig(url) {
  for (const patternConfig of config.patterns) {
    const regex = new RegExp(patternConfig.pattern);
    let pathname = url + (url.endsWith("/") ? "" : "/");
    if (regex.test(pathname)) return patternConfig;
  }
  return null;
}

function isPageData(url) {
  const pattern = /\/public\/data\/[a-f0-9-]{36}\.json/;
  return pattern.test(url);
}

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
      console.error(`[Metadata] Failed with status ${metaDataResponse.status}`);
      return DEFAULT_METADATA;
    }

    const responseJson = await metaDataResponse.json();

    if (responseJson && responseJson.source && responseJson.source["0"]) {
      const metadata = responseJson.source["0"];

      // If image is only UUID, build full URL
      if (metadata.image && !metadata.image.startsWith('http')) {
        metadata.image = `https://api.griiingo.com/storage/v1/object/public/public-user-content/companies-photos/${metadata.image}`;
      }

      return metadata;
    } else {
      console.warn("[Metadata] Empty or invalid response", responseJson);
      return DEFAULT_METADATA;
    }
  } catch (e) {
    console.error("[Metadata] Fetch error:", e);
    return DEFAULT_METADATA;
  }
}

// Rewriter
class CustomHeaderHandler {
  constructor(metadata) {
    this.metadata = metadata || DEFAULT_METADATA;
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

      if (itemprop) {
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
      }

      if (name === "robots") {
        element.setAttribute("content", "index, follow");
      }
    }
  }
}

export default {
  async fetch(request, env, ctx) {
    // ⚠️ Avoid infinite loop
    if (request.headers.get("X-Bypass-Worker") === "true") {
      return fetch(request);
    }

    try {
      const url = new URL(request.url);
      const patternConfig = getPatternConfig(url.pathname);
      const isData = isPageData(url.pathname);

      // Dynamic page metadata case
      if (patternConfig && !isData) {
        const metadata = await requestMetadata(url.pathname, patternConfig.metaDataEndpoint, env);
        const source = await fetch(`${config.domainSource}${url.pathname}`, {
          headers: {
            ...Object.fromEntries(request.headers),
            "X-Bypass-Worker": "true"
          }
        });

        const headers = new Headers(source.headers);
        headers.delete("X-Robots-Tag");

        return new HTMLRewriter()
          .on("*", new CustomHeaderHandler(metadata))
          .transform(new Response(source.body, { status: source.status, headers }));
      }

      // Page data JSON case
      if (isData) {
        const referer = request.headers.get("Referer");
        const pathname = referer?.endsWith("/") ? referer : referer + "/";
        const patternConfigForPageData = getPatternConfig(pathname);
        if (patternConfigForPageData) {
          const metadata = await requestMetadata(pathname, patternConfigForPageData.metaDataEndpoint, env);
          const sourceResponse = await fetch(`${config.domainSource}${url.pathname}`, {
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

      // Fallback: Static/default pages (apply DEFAULT_METADATA)
      const fallbackRes = await fetch(`${config.domainSource}${url.pathname}`, {
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
