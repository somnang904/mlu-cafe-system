import { STORE } from '../../config/store'

/**
 * darkSrc: optional image shown instead of src in dark mode (e.g. the logo copy with
 * light lettering). Not defaulted, because the receipt must always print the dark-ink logo.
 */
export default function BrandLogo({ className = '', alt, src, darkSrc, glow = false, ...props }) {
  const imgProps = {
    alt: alt ?? STORE.officialName,
    draggable: false,
    decoding: 'async',
    ...props,
  }
  const lightSrc = src ?? STORE.logoUrl

  const renderImages = (imgClass) =>
    darkSrc ? (
      <>
        <img className={`${imgClass} dark:hidden`.trim()} src={lightSrc} {...imgProps} />
        <img className={`${imgClass} hidden dark:block`.trim()} src={darkSrc} {...imgProps} alt="" aria-hidden />
      </>
    ) : (
      <img className={imgClass} src={lightSrc} {...imgProps} />
    )

  if (!glow) {
    if (!darkSrc) return renderImages(`object-contain ${className}`.trim())
    return <span className={`inline-flex ${className}`.trim()}>{renderImages('h-auto w-full object-contain')}</span>
  }

  // Layout/size classes on the wrapper so .brand-logo-glow::before scales to the logo box.
  return <span className={`brand-logo-glow ${className}`.trim()}>{renderImages('brand-logo-glow__img')}</span>
}
