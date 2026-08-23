import type { Metadata } from "next";
import { ImpactView } from "@/components/app/ImpactView";

export const metadata: Metadata = {
  title: "My impact",
  description:
    "The CO₂ you've avoided by running your appliances when the grid was clean.",
};

export default function ImpactPage() {
  return <ImpactView />;
}
