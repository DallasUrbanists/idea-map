import './catalog-stories.css'

// Stories keep state local so each usage canvas can be explored independently.
export const example = (components, template, setup = () => ({})) => ({
  render: () => ({ components, setup, template }),
})

