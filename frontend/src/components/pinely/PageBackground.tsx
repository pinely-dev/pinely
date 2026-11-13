/**
 * The layer behind the content of an inner page (docs/plans/ui-revamp/background).
 *
 * Every piece is decorative and `aria-hidden`. Nothing here carries information: there is no text
 * except the big outlined word, and never anything that looks like data. The styles are in the
 * "Page background layer" block of `pinely.css`.
 *
 * What a page gets depends on its variant:
 * - `desk` (data pages): a light that travels along a grid line (the packets).
 * - `reading` (docs, legal): margin rails with tick marks.
 * - `plain` (the map, which has a scope of its own): neither.
 *
 * Every page also gets the dithered band along the bottom edge and the outlined word.
 *
 * There are two containers because the pieces need different positioning: `page-bg` scrolls with the
 * page, while `page-bg-fixed` stays on the screen so the packets keep to the fixed grid lines.
 */
export type PageBackgroundVariant = "desk" | "reading" | "plain";

type Props = {
  /** A single short English word, shown large and outlined near the bottom of the page. */
  word?: string;
  variant?: PageBackgroundVariant;
};

export function PageBackground({ word, variant = "desk" }: Props) {
  return (
    <>
      <div className="page-bg" aria-hidden="true">
        {variant === "reading" ? (
          <>
            <div className="page-bg-rail page-bg-rail-left" />
            <div className="page-bg-rail page-bg-rail-right" />
          </>
        ) : null}
        <div className="page-bg-band" />
        {word ? <span className="page-bg-word">{word}</span> : null}
      </div>
      {variant === "desk" ? (
        <div className="page-bg-fixed" aria-hidden="true">
          <div className="page-bg-packet page-bg-packet-v" />
          <div className="page-bg-packet page-bg-packet-h" />
        </div>
      ) : null}
    </>
  );
}
