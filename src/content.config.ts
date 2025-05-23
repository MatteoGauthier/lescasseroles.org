import { defineCollection, reference, z } from "astro:content"
import { glob, file } from "astro/loaders"

// Entity collection
const entity = defineCollection({
  loader: glob({
    pattern: "**/*.md",
    base: "content/entities",
  }),
  schema: ({ image }) =>
    z.object({
      type: z.string(),
      name: z.string(),
      slug: z.string(),
      description: z.string().optional(),
      image: image().optional(),
    }),
})

const categorySlugs = ["politique", "ethique", "lobbying", "justice", "medias", "internet", "scandale"] as const

// Category collection
const category = defineCollection({
  loader: file("content/categories.json"),
  schema: z.object({
    name: z.string(),
    slug: z.enum(categorySlugs),
    description: z.string().optional(),
  }),
})

// Controversy collection
const controversy = defineCollection({
  loader: glob({
    pattern: "**/*.{md,mdx}",
    base: "content/controversies",
  }),
  schema: z.object({
    createdAt: z.coerce.date(),
    updatedAt: z.coerce.date(),
    title: z.string(),
    description: z.string(),
    date: z.coerce.date(),
    impact: z.enum(["MINOR", "MODERATE", "MAJOR"]),
    status: z.enum(["ALLEGED", "CONFIRMED", "DISPROVEN"]),
    // References to other collections
    entities: z.array(reference("entity")),
    sources: z.array(
      z.object({
        title: z.string(),
        description: z.string().optional(),
        type: z.enum(["NEWS", "DOCUMENT", "SOCIAL_MEDIA", "OFFICIAL_STATEMENT", "COURT_DOCUMENT", "OTHER", "INSTITUTIONAL"]),
        reliability: z.enum(["LOW", "MEDIUM", "HIGH"]),
        url: z.string().url(),
        publishedAt: z.coerce.date(),
        shortName: z.string().optional(),
        source: z.array(reference("source")).optional(),
      })
    ),
    categories: z.array(reference("category")),
  }),
})

const sourceTagSlugs = ["independant"] as const

const sourceTag = defineCollection({
  loader: file("content/source-tags.json"),
  schema: z.object({
    name: z.string(),
    slug: z.string(),
  }),
})

const source = defineCollection({
  loader: file("content/sources.json"),
  schema: z.object({
    name: z.string(),
    description: z.string().optional(),
    slug: z.string(),
    website: z.string().url(),
    tags: z.array(reference("sourceTag")),
    links: z.array(z.string().url()),
  }),
})

export const collections = {
  entity,
  controversy,
  category,
  source,
  sourceTag,
}
