import { SAFETY_PLACEHOLDER_BANNER, SAFETY_PLACEHOLDER_MARKER } from "./placeholder";

export default function SafetyPage() {
  return <main data-placeholder={SAFETY_PLACEHOLDER_MARKER}>
    <p>{SAFETY_PLACEHOLDER_BANNER}</p>
    <p>Contact: TODO(founder)</p>
  </main>;
}
