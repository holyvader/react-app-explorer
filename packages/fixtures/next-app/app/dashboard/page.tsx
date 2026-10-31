import dynamic from "next/dynamic";
import { lazy } from "react";

const Chart = dynamic(() => import("@/components/Chart"));
const Stats = lazy(() => import("@/components/Stats"));

export default function DashboardPage({ searchParams }: { searchParams: { tab?: string } }) {
  const tab = searchParams.tab ?? "chart";
  return <section>{tab === "chart" ? <Chart points={[1, 2, 3]} /> : <Stats />}</section>;
}
