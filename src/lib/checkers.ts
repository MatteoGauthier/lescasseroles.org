import type { CollectionEntry } from "astro:content"
import crypto from "crypto"
import fs from "fs/promises"
import { tryCatch } from "./utils"

// Types
export interface ImageStats {
  total: number
  remote: number
  local: number
  notSquare: number
}

export interface EntityStats {
  total: number
  withImage: number
  withDescription: number
  remoteImages: number
  localImages: number
}

export interface ControversyStats {
  total: number
  byStatus: {
    ALLEGED: number
    CONFIRMED: number
    DISPROVEN: number
  }
  withSources: number
}

export interface CategoryStats {
  total: number
  withDescription: number
}

export interface SourceStats {
  total: number
  byType: {
    NEWS: number
    DOCUMENT: number
    SOCIAL_MEDIA: number
    OTHER: number
  }
  byReliability: {
    HIGH: number
    MEDIUM: number
    LOW: number
    UNDEFINED: number
  }
}

export interface LinkStatusCount {
  valid: number
  redirects: number
  broken: number
  errors: number
}

export interface LinkCheckResult {
  url: string
  status: number
  ok: boolean
  statusText: string
}

// Helper functions
export function isRemoteImage(image: any): boolean {
  if (!image) return false
  if (typeof image === "string") return image.startsWith("http")
  return image.src?.startsWith("http") || false
}

export function getImageDimensions(image: any) {
  if (!image) return null
  if (typeof image === "object" && image.width && image.height) {
    return { width: image.width, height: image.height }
  }
  return null
}

// Cache functions
const cachePath = "tmp"

export async function getCache<T>(hash: string): Promise<T | null> {
  const { data: file, error } = await tryCatch(fs.readFile(`${cachePath}/${hash}.json`, "utf8"))
  if (error) {
    return null
  }
  const cache = JSON.parse(file)
  if (cache && cache.expires > Date.now()) {
    return cache.data
  }
  return null
}

export async function setCache(hash: string, data: any) {
  const dataCached = {
    data,
    expires: Date.now() + 1000 * 60 * 60 * 24, // 1 day
  }
  await fs.mkdir(cachePath, { recursive: true })
  await fs.writeFile(`${cachePath}/${hash}.json`, JSON.stringify(dataCached))
}

// Link checking functions
export async function checkLinkStatus(url: string): Promise<{
  status: number
  ok: boolean
  statusText: string
}> {
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 5000) // 5 second timeout
    try {
      const response = await fetch(url, {
        method: "HEAD", // Use HEAD request to just check headers without downloading content
        signal: controller.signal,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
        },
      })

      return {
        status: response.status,
        ok: response.ok,
        statusText: response.statusText,
      }
    } finally {
      clearTimeout(timeoutId)
    }
  } catch (error: unknown) {
    // Handle connection errors, timeouts, etc.
    return {
      status: 0,
      ok: false,
      statusText: error instanceof Error ? error.message : "Erreur de connexion",
    }
  }
}

export async function checkUrlsBatch(
  urls: string[],
  batchSize = 5,
  logProgress = false
): Promise<LinkCheckResult[]> {
  const hash = crypto.createHash("sha256").update(urls.join("")).digest("hex")

  const cache = await getCache<LinkCheckResult[]>(hash)

  if (cache) {
    return cache
  }

  const results: LinkCheckResult[] = []

  // Process URLs in batches
  for (let i = 0; i < urls.length; i += batchSize) {
    const batch = urls.slice(i, i + batchSize)
    if (logProgress) {
      console.log(
        `Vérification du lot ${Math.floor(i / batchSize) + 1}/${Math.ceil(
          urls.length / batchSize
        )}, URLs ${i + 1}-${Math.min(i + batchSize, urls.length)}...`
      )
    }

    // Process batch in parallel
    const batchResults = await Promise.all(
      batch.map(async (url) => {
        try {
          const status = await checkLinkStatus(url)
          return {
            url,
            status: status.status,
            ok: status.ok,
            statusText: status.statusText,
          }
        } catch (e) {
          console.error(`Erreur lors de la vérification de ${url}:`, e)
          return {
            url,
            status: 0,
            ok: false,
            statusText: "Erreur lors de la vérification",
          }
        }
      })
    )

    results.push(...batchResults)

    // Add a small delay between batches to avoid overloading
    if (i + batchSize < urls.length) {
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
  }

  await setCache(hash, results)
  return results
}

// Image checkers
export function getImageStatistics(entities: CollectionEntry<"entity">[]): ImageStats {
  return {
    total: entities.filter((e) => e.data.image).length,
    remote: entities.filter((e) => isRemoteImage(e.data.image)).length,
    local: entities.filter((e) => e.data.image && !isRemoteImage(e.data.image)).length,
    notSquare: entities.filter((e) => {
      const dimensions = getImageDimensions(e.data.image)
      return dimensions && Math.abs(dimensions.width - dimensions.height) > 10
    }).length,
  }
}

// Entity checkers
export function getEntityStatistics(entities: CollectionEntry<"entity">[], imageStats: ImageStats): EntityStats {
  return {
    total: entities.length,
    withImage: imageStats.total,
    withDescription: entities.filter((e) => e.data.description).length,
    remoteImages: imageStats.remote,
    localImages: imageStats.local,
  }
}

export function getEntitiesWithoutImages(
  entities: CollectionEntry<"entity">[],
  controversies: CollectionEntry<"controversy">[],
  limit = 5
): CollectionEntry<"entity">[] {
  return entities
    .filter((e) => !e.data.image)
    .sort((a, b) => {
      const aCount = controversies.filter((c) => 
        c.data.entities && c.data.entities.some((ref) => ref.id === a.id)
      ).length
      const bCount = controversies.filter((c) => 
        c.data.entities && c.data.entities.some((ref) => ref.id === b.id)
      ).length
      return bCount - aCount
    })
    .slice(0, limit)
}

export function getEntitiesWithRemoteImages(
  entities: CollectionEntry<"entity">[],
  controversies: CollectionEntry<"controversy">[],
  limit = 5
): CollectionEntry<"entity">[] {
  return entities
    .filter((e) => isRemoteImage(e.data.image))
    .sort((a, b) => {
      const aCount = controversies.filter((c) => 
        c.data.entities && c.data.entities.some((ref) => ref.id === a.id)
      ).length
      const bCount = controversies.filter((c) => 
        c.data.entities && c.data.entities.some((ref) => ref.id === b.id)
      ).length
      return bCount - aCount
    })
    .slice(0, limit)
}

export function getEntitiesWithNonSquareImages(
  entities: CollectionEntry<"entity">[],
  controversies: CollectionEntry<"controversy">[],
  limit = 5
): CollectionEntry<"entity">[] {
  return entities
    .filter((e) => {
      const dimensions = getImageDimensions(e.data.image)
      return dimensions && Math.abs(dimensions.width - dimensions.height) > 10
    })
    .sort((a, b) => {
      const aCount = controversies.filter((c) => 
        c.data.entities && c.data.entities.some((ref) => ref.id === a.id)
      ).length
      const bCount = controversies.filter((c) => 
        c.data.entities && c.data.entities.some((ref) => ref.id === b.id)
      ).length
      return bCount - aCount
    })
    .slice(0, limit)
}

// Controversy checkers
export function getControversyStatistics(controversies: CollectionEntry<"controversy">[]): ControversyStats {
  return {
    total: controversies.length,
    byStatus: {
      ALLEGED: controversies.filter((c) => c.data.status === "ALLEGED").length,
      CONFIRMED: controversies.filter((c) => c.data.status === "CONFIRMED").length,
      DISPROVEN: controversies.filter((c) => c.data.status === "DISPROVEN").length,
    },
    withSources: controversies.filter((c) => c.data.sources && c.data.sources.length > 0).length,
  }
}

export function getControversiesWithoutSources(
  controversies: CollectionEntry<"controversy">[],
  limit = 5
): CollectionEntry<"controversy">[] {
  return controversies
    .filter((c) => !c.data.sources || c.data.sources.length === 0)
    .sort((a, b) => new Date(b.data.date).getTime() - new Date(a.data.date).getTime())
    .slice(0, limit)
}

// Category checkers
export function getCategoryStatistics(categories: CollectionEntry<"category">[]): CategoryStats {
  return {
    total: categories.length,
    withDescription: categories.filter((c) => c.data.description).length,
  }
}

// Source checkers
export function getAllSources(controversies: CollectionEntry<"controversy">[]) {
  return controversies
    .flatMap((c) =>
      (c.data.sources || []).map((source) => ({
        controversyId: c.id,
        controversyTitle: c.data.title,
        source,
      }))
    )
    .filter((item) => item.source && item.source.url)
}

export function getSourceStatistics(allSources: ReturnType<typeof getAllSources>): SourceStats {
  return {
    total: allSources.length,
    byType: {
      NEWS: allSources.filter((item) => item.source.type === "NEWS").length,
      DOCUMENT: allSources.filter((item) => item.source.type === "DOCUMENT").length,
      SOCIAL_MEDIA: allSources.filter((item) => item.source.type === "SOCIAL_MEDIA").length || 0,
      OTHER:
        allSources.filter((item) => !["NEWS", "DOCUMENT", "SOCIAL_MEDIA"].includes(item.source.type || "")).length,
    },
    byReliability: {
      HIGH: allSources.filter((item) => item.source.reliability === "HIGH").length,
      MEDIUM: allSources.filter((item) => item.source.reliability === "MEDIUM").length,
      LOW: allSources.filter((item) => item.source.reliability === "LOW").length || 0,
      UNDEFINED:
        allSources.filter((item) => !["HIGH", "MEDIUM", "LOW"].includes(item.source.reliability || "")).length,
    },
  }
}

export function getBrokenLinks(
  allSources: ReturnType<typeof getAllSources>,
  linkStatusMap: Record<string, LinkCheckResult>,
  limit = 5
) {
  return allSources
    .filter((item) => {
      const status = linkStatusMap[item.source.url]
      return status && !status.ok
    })
    .sort((a, b) => {
      // Sort by status code (error status 0 first, then higher codes)
      const statusA = linkStatusMap[a.source.url]?.status || 0
      const statusB = linkStatusMap[b.source.url]?.status || 0
      return statusA - statusB
    })
    .slice(0, limit)
}

export function getLinkStatusCount(linkStatuses: LinkCheckResult[]): LinkStatusCount {
  return {
    valid: linkStatuses.filter((s) => s.ok).length,
    redirects: linkStatuses.filter((s) => s.status >= 300 && s.status < 400).length,
    broken: linkStatuses.filter((s) => !s.ok && s.status !== 0).length,
    errors: linkStatuses.filter((s) => s.status === 0).length,
  }
}

export function createLinkStatusMap(linkStatuses: LinkCheckResult[]): Record<string, LinkCheckResult> {
  return linkStatuses.reduce(
    (acc, status) => {
      acc[status.url] = status
      return acc
    },
    {} as Record<string, LinkCheckResult>
  )
}

export function getSourcesToDisplay(
  brokenLinks: ReturnType<typeof getBrokenLinks>,
  allSources: ReturnType<typeof getAllSources>,
  limit = 5
) {
  return brokenLinks.length > 0
    ? brokenLinks
    : allSources
        .sort((a, b) => {
          // Sort by published date if available, otherwise use controversy date
          const dateA = a.source.publishedAt ? new Date(a.source.publishedAt) : new Date()
          const dateB = b.source.publishedAt ? new Date(b.source.publishedAt) : new Date()
          return dateB.getTime() - dateA.getTime()
        })
        .slice(0, limit)
}

// Ajout de nouvelles fonctions sans limite d'éléments
export function getAllEntitiesWithoutImages(
  entities: CollectionEntry<"entity">[],
  controversies: CollectionEntry<"controversy">[]
): CollectionEntry<"entity">[] {
  return entities
    .filter((e) => !e.data.image)
    .sort((a, b) => {
      const aCount = controversies.filter((c) => 
        c.data.entities && c.data.entities.some((ref) => ref.id === a.id)
      ).length
      const bCount = controversies.filter((c) => 
        c.data.entities && c.data.entities.some((ref) => ref.id === b.id)
      ).length
      return bCount - aCount
    })
}

export function getAllEntitiesWithRemoteImages(
  entities: CollectionEntry<"entity">[],
  controversies: CollectionEntry<"controversy">[]
): CollectionEntry<"entity">[] {
  return entities
    .filter((e) => isRemoteImage(e.data.image))
    .sort((a, b) => {
      const aCount = controversies.filter((c) => 
        c.data.entities && c.data.entities.some((ref) => ref.id === a.id)
      ).length
      const bCount = controversies.filter((c) => 
        c.data.entities && c.data.entities.some((ref) => ref.id === b.id)
      ).length
      return bCount - aCount
    })
}

export function getAllEntitiesWithNonSquareImages(
  entities: CollectionEntry<"entity">[],
  controversies: CollectionEntry<"controversy">[]
): CollectionEntry<"entity">[] {
  return entities
    .filter((e) => {
      const dimensions = getImageDimensions(e.data.image)
      return dimensions && Math.abs(dimensions.width - dimensions.height) > 10
    })
    .sort((a, b) => {
      const aCount = controversies.filter((c) => 
        c.data.entities && c.data.entities.some((ref) => ref.id === a.id)
      ).length
      const bCount = controversies.filter((c) => 
        c.data.entities && c.data.entities.some((ref) => ref.id === b.id)
      ).length
      return bCount - aCount
    })
}

export function getAllControversiesWithoutSources(
  controversies: CollectionEntry<"controversy">[]
): CollectionEntry<"controversy">[] {
  return controversies
    .filter((c) => !c.data.sources || c.data.sources.length === 0)
    .sort((a, b) => new Date(b.data.date).getTime() - new Date(a.data.date).getTime())
}

export function getAllBrokenLinks(
  allSources: ReturnType<typeof getAllSources>,
  linkStatusMap: Record<string, LinkCheckResult>
) {
  return allSources
    .filter((item) => {
      const status = linkStatusMap[item.source.url]
      return status && !status.ok
    })
    .sort((a, b) => {
      // Sort by status code (error status 0 first, then higher codes)
      const statusA = linkStatusMap[a.source.url]?.status || 0
      const statusB = linkStatusMap[b.source.url]?.status || 0
      return statusA - statusB
    })
}

export function getAllSourcesToDisplay(
  brokenLinks: ReturnType<typeof getAllBrokenLinks>,
  allSources: ReturnType<typeof getAllSources>
) {
  return brokenLinks.length > 0
    ? brokenLinks
    : allSources
        .sort((a, b) => {
          // Sort by published date if available, otherwise use controversy date
          const dateA = a.source.publishedAt ? new Date(a.source.publishedAt) : new Date()
          const dateB = b.source.publishedAt ? new Date(b.source.publishedAt) : new Date()
          return dateB.getTime() - dateA.getTime()
        })
}

// Main check function avec accès à toutes les données
export async function checkAllCasebase(
  entities: CollectionEntry<"entity">[],
  controversies: CollectionEntry<"controversy">[],
  categories: CollectionEntry<"category">[],
  logProgress = false
) {
  // Analyze images
  const imageStats = getImageStatistics(entities)
  
  // Entity statistics
  const entityStats = getEntityStatistics(entities, imageStats)
  
  // Controversy statistics
  const controversyStats = getControversyStatistics(controversies)
  
  // Category statistics
  const categoryStats = getCategoryStatistics(categories)
  
  // Combined stats
  const stats = {
    entities: entityStats,
    controversies: controversyStats,
    categories: categoryStats,
  }
  
  // Get all sources from controversies
  const allSources = getAllSources(controversies)
  
  // Source statistics
  const sourceStats = getSourceStatistics(allSources)
  
  // Extract unique URLs for checking
  const uniqueUrls = [...new Set(allSources.map((item) => item.source.url))]
  
  if (logProgress) {
    console.log(`Vérification de ${uniqueUrls.length} liens uniques...`)
  }
  
  // Check links
  const linkStatuses = await checkUrlsBatch(uniqueUrls, 5, logProgress)
  
  if (logProgress) {
    console.log(
      `Vérification terminée : ${linkStatuses.filter((s) => s.ok).length} liens valides, ${
        linkStatuses.filter((s) => !s.ok).length
      } problèmes`
    )
  }
  
  // Create lookup map for link statuses
  const linkStatusMap = createLinkStatusMap(linkStatuses)
  
  // Link status counts
  const linkStatusCount = getLinkStatusCount(linkStatuses)
  
  // Entities that need attention - sans limite
  const entitiesWithoutImages = getAllEntitiesWithoutImages(entities, controversies)
  const entitiesWithRemoteImages = getAllEntitiesWithRemoteImages(entities, controversies)
  const entitiesWithBadImages = getAllEntitiesWithNonSquareImages(entities, controversies)
  
  // Controversies that need attention - sans limite
  const controversiesWithoutSources = getAllControversiesWithoutSources(controversies)
  
  // Sources that need attention - sans limite
  const brokenLinks = getAllBrokenLinks(allSources, linkStatusMap)
  
  // Sources to display - sans limite
  const sourcesToDisplay = getAllSourcesToDisplay(brokenLinks, allSources)
  
  return {
    imageStats,
    stats,
    sourceStats,
    linkStatusCount,
    linkStatuses,
    linkStatusMap,
    entitiesWithoutImages,
    entitiesWithRemoteImages,
    entitiesWithBadImages,
    controversiesWithoutSources,
    brokenLinks,
    sourcesToDisplay,
  }
}

// Main check function (version avec limites pour la rétrocompatibilité)
export async function checkCasebase(
  entities: CollectionEntry<"entity">[],
  controversies: CollectionEntry<"controversy">[],
  categories: CollectionEntry<"category">[],
  logProgress = false
) {
  const allResults = await checkAllCasebase(entities, controversies, categories, logProgress);
  
  // Applique les limites aux résultats illimités
  return {
    ...allResults,
    entitiesWithoutImages: allResults.entitiesWithoutImages.slice(0, 5),
    entitiesWithRemoteImages: allResults.entitiesWithRemoteImages.slice(0, 5),
    entitiesWithBadImages: allResults.entitiesWithBadImages.slice(0, 5),
    controversiesWithoutSources: allResults.controversiesWithoutSources.slice(0, 5),
    brokenLinks: allResults.brokenLinks.slice(0, 5),
    sourcesToDisplay: allResults.sourcesToDisplay.slice(0, 5),
  };
} 
