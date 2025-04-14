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
