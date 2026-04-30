import { ComposioSection } from "./ComposioSection.js";

export function ConnectionsPanel({ isDark }: { isDark: boolean }) {
  return (
    <div className="editorial-panel-shell h-full overflow-y-auto debug-scroll">
      <ComposioSection isDark={isDark} />
    </div>
  );
}
