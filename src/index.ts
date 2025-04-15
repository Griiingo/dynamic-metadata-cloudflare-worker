import { config } from '../config.js';

const DEFAULT_METADATA = {
  title: "Griiingo",
  description: "Conectamos imigrantes e turistas à comunidade brasileira. Encontre empresas, serviços, eventos e empregos de brasileiros, fora do Brasil.",
  keywords: "empresas brasileiras, serviços brasileiros, eventos brasileiros, empregos brasileiros",
  image: "https://api.griiingo.com/storage/v1/object/public/public-griiingo-content/general/griiingo-profile.png",
  type: "LocalBusiness"
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

function inferTypeFromEndpoint(endpoint) {
  if (endpoint.includes("companies_metadata")) return "LocalBusiness";
  if (endpoint.includes("services_metadata")) return "Service";
  if (endpoint.includes("events_metadata")) return "Event";
  if (endpoint.includes("jobs_metadata")) return "JobPosting";
  if (endpoint.includes("benefits_metadata")) return "Offer";
  return "Content";
}

function resolveImagePath(endpoint, image) {
  if (!image || image.startsWith("http")) return image;

  if (endpoint.includes("companies_metadata") || endpoint.includes("jobs_metadata") || endpoint.includes("benefits_metadata")) {
    return `https://api.griiingo.com/storage/v1/object/public/public-user-content/companies-photos/${image}`;
  } else if (endpoint.includes("events_metadata")) {
    return `https://api.griiingo.com/storage/v1/object/public/public-user-content/events-photos/${image}`;
  } else if (endpoint.includes("articles_metadata")) {
    return `https://api.griiingo.com/storage/v1/object/public/public-griiingo-content/general/${image}`;
  }

  return image;
}

async function requestMetadata(slug, metaDataEndpoint, env) {
  try {
    const finalEndpoint = `${metaDataEndpoint}?slug=eq.${slug}&select=title,description,keywords,image`;
    console.log(`[Worker] Fetching metadata for slug "${slug}" via endpoint ${finalEndpoint}`);
    const response = await fetch(finalEndpoint, {
      headers: {
        apikey: env.SUPABASE_KEY,
        Authorization: `Bearer ${env.SUPABASE_KEY}`,
        "Content-Type": "application/json"
      }
    });

    if (!response.ok) {
      console.error(`[Metadata] Failed with status ${response.status}`);
      return { ...DEFAULT_METADATA, type: inferTypeFromEndpoint(metaDataEndpoint) };
    }

    const data = await response.json();
    if (Array.isArray(data) && data.length > 0) {
      const metadata = data[0];
      metadata.image = resolveImagePath(metaDataEndpoint, metadata.image);
      return {
        ...DEFAULT_METADATA,
        ...metadata,
        type: inferTypeFromEndpoint(metaDataEndpoint)
      };
    }

    console.warn("[Metadata] No result for slug:", slug);
    return { ...DEFAULT_METADATA, type: inferTypeFromEndpoint(metaDataEndpoint) };
  } catch (err) {
    console.error("[Metadata] Fetch error:", err);
    return { ...DEFAULT_METADATA, type: inferTypeFromEndpoint(metaDataEndpoint) };
  }
}

class CustomHeaderHandler {
  constructor(metadata) {
    this.metadata = { ...DEFAULT_METADATA, ...metadata };
  }

  element(element) {
    const meta = this.metadata;

    const metadataMap = {
      title: meta.title,
      description: meta.description,
      keywords: meta.keywords,
      image: meta.image,
      "og:title": meta.title,
      "og:description": meta.description,
      "og:site_name": meta.title,
      "og:type": meta.type,
      "og:image": meta.image,
      "twitter:title": meta.title,
      "twitter:description": meta.description,
      "twitter:image": meta.image,
      "twitter:card": meta.image
    };

    if (element.tagName === "title") {
      element.setInnerContent(this.metadata.title);
    }

    if (element.tagName === "meta") {
	const name = element.getAttribute("name") || "";
      const property = element.getAttribute("property") || "";
      const itemprop = element.getAttribute("itemprop") || "";

      if (metadataMap[name]) element.setAttribute("content", metadataMap[name]);
      if (metadataMap[property]) element.setAttribute("content", metadataMap[property]);
      if (itemprop === "name") {
        element.setAttribute("content", meta.title);
      } else if (itemprop === "description") {
        element.setAttribute("content", meta.description);
      } else if (itemprop === "image") {
        element.setAttribute("content", meta.image);
      }

      if (name === "robots") {
        element.setAttribute("content", "index, follow");
      }
    }

    if (element.tagName === "head") {
      const structuredData = {
        "@context": "https://schema.org",
        "@type": meta.type || "Content",
        "name": meta.title,
        "description": meta.description,
        "url": this.url?.href || "https://www.griiingo.com",
        "image": meta.image
      };

      if (meta.type === "LocalBusiness") {
        structuredData.address = {
          "@type": "PostalAddress",
          "addressLocality": "Cidade",
          "addressRegion": "Estado",
          "addressCountry": "Estados Unidos"
        },
	structuredData.telephone = "",
	structuredData.priceRange = "";
      }

      if (meta.type === "Event") {
        structuredData.startDate = meta.startDate || "2025-12-01";
        structuredData.eventStatus = "https://schema.org/EventScheduled";
        structuredData.eventAttendanceMode = "https://schema.org/OnlineEventAttendanceMode";
      }

      element.append(`
        <script type="application/ld+json">
        ${JSON.stringify(structuredData, null, 2)}
        </script>
      `, { html: true });
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
      if (patternConfig && !isData) {
        const slug = pathname.split("/").filter(Boolean).pop();
        const metadata = await requestMetadata(slug, patternConfig.metaDataEndpoint, env);
        console.log("[Worker] Metadata used:", metadata);

        const sourceResponse = await fetch(`${config.domainSource}${pathname}`, {
          method: "GET",
          headers: {
            ...Object.fromEntries(
              [...request.headers].filter(([key]) => ![
                "if-modified-since",
                "if-none-match",
                "x-forwarded-proto"
              ].includes(key.toLowerCase()))
            ),
            "X-Bypass-Worker": "true"
          }
        });

        const headers = new Headers(sourceResponse.headers);
        headers.delete("X-Robots-Tag");

        return new HTMLRewriter()
          .on("*", new CustomHeaderHandler(metadata))
          .transform(new Response(sourceResponse.body, { status: sourceResponse.status, headers }));
      }

      if (isData) {
        const referer = request.headers.get("Referer");
        const refPath = referer ? new URL(referer).pathname : null;
        const patternConfig = getPatternConfig(refPath);

        if (patternConfig) {
          const slug = refPath.split("/").filter(Boolean).pop();
          const metadata = await requestMetadata(slug, patternConfig.metaDataEndpoint, env);
          const sourceResponse = await fetch(`${config.domainSource}${pathname}`, {
            method: "GET",
            headers: {
              "X-Bypass-Worker": "true"
            }
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

      const fallbackRes = await fetch(`${config.domainSource}${pathname}`, {
        method: "GET",
        headers: {
          ...Object.fromEntries(
            [...request.headers].filter(([key]) => ![
              "if-modified-since",
              "if-none-match",
              "x-forwarded-proto"
            ].includes(key.toLowerCase()))
          ),
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
