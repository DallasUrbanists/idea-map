import searchReveal from '../../assets/lordicon-collection-839425/system-outline-19-magnifier-in-reveal.json?url'
import searchHover from '../../assets/lordicon-collection-839425/system-outline-19-magnifier-hover-pinch.json?url'
import clockReveal from '../../assets/lordicon-collection-839425/system-solid-45-clock-in-reveal.json?url'
import clockHover from '../../assets/lordicon-collection-839425/system-solid-45-clock-hover-pinch.json?url'
import avatarHover from '../../assets/lordicon-collection-839425/system-solid-21-avatar-hover-pinch.json?url'
import globeReveal from '../../assets/lordicon-collection-839425/system-solid-27-globe-in-reveal.json?url'
import globeHover from '../../assets/lordicon-collection-839425/system-solid-27-globe-hover-pinch.json?url'
import bookmarkReveal from '../../assets/lordicon-collection-839425/system-solid-400-bookmark-in-reveal.json?url'
import bookmarkHover from '../../assets/lordicon-collection-839425/system-solid-400-bookmark-hover-pinch.json?url'
import wrenchReveal from '../../assets/lordicon-collection-839425/system-solid-409-wrench-in-reveal.json?url'
import wrenchHover from '../../assets/lordicon-collection-839425/system-solid-409-wrench-hover-pinch.json?url'
import pinReveal from '../../assets/lordicon-collection-839425/system-solid-18-location-pin-in-reveal.json?url'
import pinHover from '../../assets/lordicon-collection-839425/system-solid-18-location-pin-hover-pinch.json?url'
import warningReveal from '../../assets/lordicon-collection-839425/system-solid-1140-warning-triangle-in-reveal.json?url'
import warningHover from '../../assets/lordicon-collection-839425/system-solid-1140-warning-triangle-hover-pinch.json?url'
import expandReveal from '../../assets/lordicon-collection-839425/system-solid-375-arrows-vertical-expand-in-reveal.json?url'
import expandHover from '../../assets/lordicon-collection-839425/system-solid-375-arrows-vertical-expand-hover-pinch.json?url'
import collapseReveal from '../../assets/lordicon-collection-839425/system-solid-376-arrows-vertical-compress-in-reveal.json?url'
import collapseHover from '../../assets/lordicon-collection-839425/system-solid-376-arrows-vertical-compress-hover-pinch.json?url'
import homeReveal from '../../assets/lordicon-collection-839425/system-solid-63-home-in-reveal.json?url'
import homeHover from '../../assets/lordicon-collection-839425/system-solid-63-home-hover-pinch.json?url'
import infoReveal from '../../assets/lordicon-collection-839425/system-outline-367-info-circle-in-reveal.json?url'
import infoHover from '../../assets/lordicon-collection-839425/system-outline-367-info-circle-hover-pinch.json?url'
import checkReveal from '../../assets/lordicon-collection-839425/system-outline-37-check-in-reveal.json?url'
import checkHover from '../../assets/lordicon-collection-839425/system-outline-37-check-hover-pinch.json?url'
import errorReveal from '../../assets/lordicon-collection-839425/system-solid-260-warning-circle-in-reveal.json?url'
import errorHover from '../../assets/lordicon-collection-839425/system-solid-260-warning-circle-hover-pinch.json?url'
import spinnerReveal from '../../assets/lordicon-collection-839425/system-outline-4021-spinner-circle-in-reveal.json?url'
import spinnerLoop from '../../assets/lordicon-collection-839425/system-outline-4021-spinner-circle-loop-rotation-half.json?url'

export const iconAssets = {
  search: { reveal: searchReveal, hover: searchHover },
  history: { reveal: clockReveal, hover: clockHover },
  avatar: { reveal: avatarHover, hover: avatarHover, noReveal: true },
  explore: { reveal: globeReveal, hover: globeHover },
  saved: { reveal: bookmarkReveal, hover: bookmarkHover },
  settings: { reveal: wrenchReveal, hover: wrenchHover },
  location: { reveal: pinReveal, hover: pinHover },
  warning: { reveal: warningReveal, hover: warningHover },
  info: { reveal: infoReveal, hover: infoHover },
  success: { reveal: checkReveal, hover: checkHover },
  error: { reveal: errorReveal, hover: errorHover },
  expand: { reveal: expandReveal, hover: expandHover },
  collapse: { reveal: collapseReveal, hover: collapseHover },
  home: { reveal: homeReveal, hover: homeHover },
  spinner: { reveal: spinnerReveal, loop: spinnerLoop },
} as const
export type IconName = keyof typeof iconAssets
