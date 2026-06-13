/** Hint for horizontally scrollable data tables on narrow screens. */
export default function ScrollHint() {
  return (
    <p className="md:hidden text-caption text-text-muted mb-2">
      Scroll horizontally for more columns →
    </p>
  );
}
