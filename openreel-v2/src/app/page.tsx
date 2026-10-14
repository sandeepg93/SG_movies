import Link from "next/link";
import Catalog from "@/components/Catalog";
import { getPublicMovies } from "@/lib/catalog";

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function HomePage({ searchParams }: Props) {
  const raw = await searchParams;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    const single = Array.isArray(value) ? value[0] : value;
    if (typeof single === "string") params.set(key, single);
  }
  const initialSearch = params.toString();
  const movies = getPublicMovies();

  if (movies.length === 0) {
    return (
      <div className="empty-state">
        <h1>No films published yet</h1>
        <p>
          Every film is reviewed before it appears here. Check back soon, or read our{" "}
          <Link href="/rights">rights policy</Link>.
        </p>
      </div>
    );
  }

  return <Catalog key={initialSearch} movies={movies} initialSearch={initialSearch} />;
}
