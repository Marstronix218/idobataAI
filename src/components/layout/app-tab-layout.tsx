import { MomentumRail } from "@/components/layout/momentum-rail";

export function AppTabLayout({
  children,
  padded = false,
  contextRail = true,
}: {
  children: React.ReactNode;
  padded?: boolean;
  contextRail?: boolean;
}) {
  if (!contextRail) {
    return <div className="mx-auto min-h-screen w-full max-w-[980px] pb-20 lg:mx-0 lg:pb-0">
      <div className={padded ? "min-w-0 px-4 pb-8 pt-5 md:px-8 md:pt-8" : "min-w-0"}>{children}</div>
    </div>;
  }

  return <div className="mx-auto grid min-h-screen w-full pb-20 md:max-w-[620px] lg:mx-0 lg:pb-0 xl:max-w-[1050px] xl:grid-cols-[minmax(0,620px)_350px] xl:gap-7">
    <div className={padded ? "min-w-0 px-4 pb-8 pt-5 md:px-8 md:pt-8" : "min-w-0"}>{children}</div>
    <MomentumRail />
  </div>;
}
