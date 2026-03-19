import React from "react";
import Head from "next/head";

// ============================================================
// SEO Head Component
// ============================================================

interface SEOHeadProps {
  title?: string;
  description?: string;
  canonical?: string;
  ogImage?: string;
  ogType?: "website" | "article";
  noIndex?: boolean;
  keywords?: string[];
  twitterCard?: "summary" | "summary_large_image";
}

const SITE_NAME = "ZeroID on Aethelred";
const DEFAULT_DESCRIPTION =
  "Self-sovereign identity management on the Aethelred blockchain. Create, manage, and verify decentralized identities and verifiable credentials with zero-knowledge proof privacy.";
const DEFAULT_OG_IMAGE = "/og-zeroid.png";
const BASE_URL = "https://zeroid.aethelred.io";

export function SEOHead({
  title,
  description = DEFAULT_DESCRIPTION,
  canonical,
  ogImage = DEFAULT_OG_IMAGE,
  ogType = "website",
  noIndex = false,
  keywords = [],
  twitterCard = "summary_large_image",
}: SEOHeadProps) {
  const fullTitle = title ? `${title} | ${SITE_NAME}` : SITE_NAME;
  const canonicalUrl = canonical ? `${BASE_URL}${canonical}` : undefined;

  const defaultKeywords = [
    "self-sovereign identity",
    "SSI",
    "DID",
    "decentralized identity",
    "verifiable credentials",
    "zero-knowledge proofs",
    "ZKP",
    "Aethelred",
    "blockchain identity",
    "Web3 identity",
  ];

  const allKeywords = [...new Set([...defaultKeywords, ...keywords])];

  return (
    <Head>
      <title>{fullTitle}</title>
      <meta name="description" content={description} />
      <meta name="keywords" content={allKeywords.join(", ")} />

      {/* Canonical */}
      {canonicalUrl && <link rel="canonical" href={canonicalUrl} />}

      {/* Robots */}
      {noIndex && <meta name="robots" content="noindex, nofollow" />}

      {/* Open Graph */}
      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={description} />
      <meta property="og:type" content={ogType} />
      <meta property="og:image" content={ogImage} />
      <meta property="og:site_name" content={SITE_NAME} />
      {canonicalUrl && <meta property="og:url" content={canonicalUrl} />}

      {/* Twitter Card */}
      <meta name="twitter:card" content={twitterCard} />
      <meta name="twitter:title" content={fullTitle} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={ogImage} />

      {/* Additional meta */}
      <meta name="application-name" content="ZeroID" />
      <meta name="theme-color" content="#0f172a" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <link rel="icon" href="/favicon.ico" />
    </Head>
  );
}
