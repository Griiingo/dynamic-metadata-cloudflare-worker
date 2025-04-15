import { config } from '../config.js';

const DEFAULT_METADATA = {
  title: "Griiingo",
  description: "Conectamos imigrantes e turistas à comunidade brasileira. Encontre empresas, serviços, eventos e empregos de brasileiros, fora do Brasil.",
  keywords: "empresas brasileiras, serviços brasileiros, eventos brasileiros, empregos brasileiros",
  image: "https://api.griiingo.com/storage/v1/object/public/public-griiingo-content/general/griiingo-profile.png"
};

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
    const metadata = responseJson?.source?.["0"];

    if (metadata && metadata.title) {
      if (metadata.image && !metadata.image.startsWith("http")) {
        metadata.image = `https://api.griiingo.com/storage/v1/object/public/public-user-content/companies-photos/${metadata.image}`;
      }
      console.log("[Metadata] Final metadata used:", metadata);
      return metadata;
    }

    console.warn("[Metadata] Empty or invalid response", responseJson);
    return DEFAULT_METADATA;
  } catch (e) {
    console.error("[Metadata] Fetch error:", e);
    return DEFAULT_METADATA;
  }
}

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
      console.log("[Rewriter] Updating <title>");
      element.setInnerContent(this.metadata.title);
    }

    if (element.tagName === "meta") {
      const name = element.getAttribute("name");
      const property = element.getAttribute("property");
      const itemprop = element.getAttribute("itemprop");

      if (metadataMap[name]) {
        console.log(`[Rewriter] Updating <meta name="${name}">`);
        element.setAttribute("content", metadataMap[name]);
      }

      if (metadataMap[property]) {
        console.log(`[Rewriter] Updating <meta property="${property}">`);
        element.setAttribute("content", metadataMap[property]);
      }

      if (itemprop) {
        switch (itemprop) {
          case "name":
          case "description":
          case "image":
            console.log(`[Rewriter] Updating <meta itemprop="${itemprop}">`);
            element.setAttribute("content", metadataMap[itemprop]);
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
    if (request.headers.get("X-Bypass-Worker") === "true") {
      return fetch(request);
    }

    try {
      const url = new URL(request.url);
      const patternConfig = getPatternConfig(url.pathname);
      const isData = isPageData(url.pathname);

      if (patternConfig && !isData) {
        const metadata = await requestMetadata(url.pathname, patternConfig.metaDataEndpoint, env);
        console.log("[Worker] Injecting metadata into HTMLRewriter for:", url.pathname);

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

      // Fallback case
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
