// Public idea storage is not implemented yet. Fail closed: never expose drafts.
export default defineEventHandler(() => {
  throw createError({ statusCode: 404, statusMessage: 'Idea not found' })
})
