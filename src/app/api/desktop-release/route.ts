import { NextRequest, NextResponse } from "next/server";
import { getDeviceAccount } from "@/lib/device-auth";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ReleaseAsset = {name?: string; state?: string; browser_download_url?: string; size?: number};
type Release = {tag_name?: string; draft?: boolean; prerelease?: boolean; assets?: ReleaseAsset[]};

export async function GET(request: NextRequest) {
  const auth = await getDeviceAccount(request);
  if ("response" in auth) return auth.response;
  const headers = {"Cache-Control":"no-store"};
  try {
    // Discover published beta builds from the fixed repository, not arbitrary download URLs.
    // A short shared upstream cache avoids exhausting GitHub's unauthenticated rate limit.
    const response = await fetch("https://api.github.com/repos/alexnuvora/McpOS/releases?per_page=100", {
      headers:{Accept:"application/vnd.github+json"},
      next:{revalidate:60}, signal:AbortSignal.timeout(5000)
    });
    if (!response.ok) throw new Error("Release unavailable");
    const releases = await response.json() as Release[];
    if (!Array.isArray(releases)) throw new Error("Unexpected release response");
    const candidates = releases.flatMap(release => {
      const match = /^v(\d+)\.(\d+)\.(\d+)-beta\.(\d+)$/.exec(release.tag_name ?? "");
      if (!match || release.draft !== false || release.prerelease !== true || !Array.isArray(release.assets)) return [];
      const numbers = match.slice(1).map(Number);
      if (!numbers.every(Number.isSafeInteger)) return [];
      return [{release,tag:match[0],version:numbers.slice(0,3).join("."),numbers}];
    }).sort((a,b) => {
      for (let i=0;i<4;i++) if (a.numbers[i] !== b.numbers[i]) return b.numbers[i] - a.numbers[i];
      return 0;
    });
    for (const {release,tag,version} of candidates) {
      const base = "https://github.com/alexnuvora/McpOS/releases/download/" + tag + "/";
      const stem = "McpOS-" + tag.slice(1) + "-unsigned";
      const names = [stem+".exe",stem+".msi","SHA256SUMS.txt"];
      const assets = names.flatMap(name => {
        const asset = release.assets?.find(a => a.name === name);
        if (!asset || asset.state !== "uploaded" || asset.browser_download_url !== base + name || typeof asset.size !== "number" || !Number.isSafeInteger(asset.size) || asset.size <= 0) return [];
        return [{name,url:base + name,size:asset.size}];
      });
      if (assets.length !== names.length) continue;
      return NextResponse.json({available:true,version,tag,assets,unsigned:true},{headers});
    }
    return NextResponse.json({available:false},{headers});
  } catch { return NextResponse.json({available:false,error:"Could not verify release availability."},{status:503,headers}); }
}
