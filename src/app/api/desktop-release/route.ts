import { NextRequest, NextResponse } from "next/server";
import { getDeviceAccount } from "@/lib/device-auth";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const releases = [{tag:"v0.2.1-beta.1",version:"0.2.1"},{tag:"v0.2.0-beta.1",version:"0.2.0"}];
export async function GET(request: NextRequest) {
  const auth = await getDeviceAccount(request);
  if ("response" in auth) return auth.response;
  const headers = {"Cache-Control":"no-store"};
  try {
    for (const {tag,version} of releases) {
    const base = "https://github.com/alexnuvora/McpOS/releases/download/" + tag + "/";
    const stem = "McpOS-" + tag.slice(1) + "-unsigned";
    const names = [stem+".exe",stem+".msi","SHA256SUMS.txt"];
    const response = await fetch("https://api.github.com/repos/alexnuvora/McpOS/releases/tags/" + tag, {headers:{Accept:"application/vnd.github+json"},cache:"no-store",signal:AbortSignal.timeout(5000)});
    if (response.status === 404) continue;
    if (!response.ok) throw new Error("Release unavailable");
    const release = await response.json();
    if (release.tag_name !== tag || release.draft !== false || release.prerelease !== true || !Array.isArray(release.assets)) throw new Error("Unexpected release");
    const assets = names.map(name => {
      const asset = release.assets.find((a: {name?: string}) => a.name === name);
      if (!asset || asset.state !== "uploaded" || asset.browser_download_url !== base + name || !Number.isSafeInteger(asset.size) || asset.size <= 0) throw new Error("Missing release asset");
      return {name,url:base + name,size:asset.size};
    });
    return NextResponse.json({available:true,version,tag,assets,unsigned:true},{headers});
    }
    return NextResponse.json({available:false},{headers});
  } catch { return NextResponse.json({available:false,error:"Could not verify release availability."},{status:503,headers}); }
}
