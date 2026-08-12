import type { Metadata } from "next";
import { CompanionDirectory } from "@/components/companions/companion-directory";
export const metadata: Metadata = { title: "AI companions" };
export default function CompanionsPage() { return <div className="app-page max-w-[900px]"><CompanionDirectory /></div>; }
