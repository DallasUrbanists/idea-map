import tokenCss from '../../src/styles/tokens.css?raw'

function collectDeclarations(rules, condition = '') {
  const declarations = []
  for (const rule of rules) {
    if (rule.style && rule.selectorText) {
      for (const name of rule.style) {
        if (name.startsWith('--')) {
          declarations.push({
            name,
            value: rule.style.getPropertyValue(name).trim(),
            selector: rule.selectorText,
            condition,
          })
        }
      }
    } else if (rule.cssRules) {
      const context = rule.conditionText ? `@media ${rule.conditionText}` : rule.cssText.split('{')[0].trim()
      declarations.push(...collectDeclarations(rule.cssRules, [condition, context].filter(Boolean).join(' / ')))
    }
  }
  return declarations
}

// Accept CSS text so other references and tests can use the same reader.
export function createTokenReader(cssText) {
  const sheet = new CSSStyleSheet()
  sheet.replaceSync(cssText)
  const tokenDeclarations = collectDeclarations(sheet.cssRules)

  function getTokenDefinitions() {
    const tokens = new Map()
    for (const declaration of tokenDeclarations) {
      if (!tokens.has(declaration.name)) tokens.set(declaration.name, [])
      tokens.get(declaration.name).push(declaration)
    }
    return [...tokens].map(([name, declarations]) => ({ name, declarations }))
  }

  function getDeclaredValue(name, theme, reducedMotion = false) {
    const defaults = tokenDeclarations.filter(item => item.name === name && !item.condition && item.selector === ':root')
    const dark = tokenDeclarations.filter(item => item.name === name && !item.condition && /^:root\[data-theme=["']dark["']\]$/.test(item.selector))
    const reduced = tokenDeclarations.filter(item => item.name === name && item.condition === '@media (prefers-reduced-motion: reduce)' && item.selector === ':root')
    const declaration = (reducedMotion && reduced.length ? reduced : theme === 'dark' && dark.length ? dark : defaults).at(-1)
    if (!declaration) throw new Error(`Missing ${theme} definition for ${name} in tokens.css`)
    return declaration.value
  }

  // Follow aliases so semantic color rows display their actual palette token.
  function getPaletteToken(name, theme = 'light') {
    const visited = new Set()
    while (!name.startsWith('--palette-')) {
      if (visited.has(name)) throw new Error(`Circular token alias: ${name}`)
      visited.add(name)
      const alias = getDeclaredValue(name, theme).match(/^var\(\s*(--[\w-]+)\s*\)$/)
      if (!alias) throw new Error(`${name} does not resolve to a thematic palette token`)
      name = alias[1]
    }
    return name
  }

  function getTokenValue(name, theme = 'light', visited = new Set(), reducedMotion = false) {
    if (visited.has(name)) throw new Error(`Circular token alias: ${name}`)
    const next = new Set(visited).add(name)
    return getDeclaredValue(name, theme, reducedMotion).replace(/var\(\s*(--[\w-]+)\s*\)/g, (_, alias) => getTokenValue(alias, theme, next, reducedMotion))
  }

  function getMotionValue(name, reducedMotion = false) {
    return getTokenValue(name, 'light', new Set(), reducedMotion)
  }

  function getTokenGroups() {
    const groups = { colors: [], motion: [], globals: [] }
    for (const { name } of getTokenDefinitions()) {
      const standard = getMotionValue(name)
      const reduced = getMotionValue(name, true)
      if (name.startsWith('--motion-') || standard !== reduced) {
        groups.motion.push({ name, standard, reduced })
        continue
      }
      const light = getTokenValue(name, 'light')
      const dark = getTokenValue(name, 'dark')
      const isColor = CSS.supports('color', light) && CSS.supports('color', dark)
      const isImage = CSS.supports('background-image', light) && CSS.supports('background-image', dark)
      if (isColor || isImage) {
        groups.colors.push({ name, light: isColor ? getColorValue(name, 'light') : light, dark: isColor ? getColorValue(name, 'dark') : dark })
      } else {
        if (light !== dark) throw new Error(`${name} varies by theme but is not a color or background image`)
        groups.globals.push({ name, value: getDeclaredValue(name, 'light') })
      }
    }
    for (const group of Object.values(groups)) {
      group.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
    }
    return groups
  }

  // Normalize any supported opaque CSS color to a consistent hexadecimal label.
  function getColorValue(name, theme = 'light') {
    const value = getTokenValue(name, theme)
    if (!CSS.supports('color', value)) throw new Error(`${name} is not a CSS color: ${value}`)
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const context = canvas.getContext('2d', { willReadFrequently: true })
    context.clearRect(0, 0, 1, 1)
    context.fillStyle = value
    context.fillRect(0, 0, 1, 1)
    const [r, g, b, alpha] = context.getImageData(0, 0, 1, 1).data
    if (alpha !== 255) throw new Error(`${name} is not an opaque color: ${value}`)
    return `#${[r, g, b].map(channel => channel.toString(16).padStart(2, '0')).join('').toUpperCase()}`
  }

  return { getTokenDefinitions, getPaletteToken, getTokenValue, getColorValue, getMotionValue, getTokenGroups }
}

export const { getTokenDefinitions, getPaletteToken, getTokenValue, getColorValue, getMotionValue, getTokenGroups } = createTokenReader(tokenCss)
