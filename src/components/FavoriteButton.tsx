import { useFavorites } from "../lib/useUserLists";

export function FavoriteButton({ toolId }: { toolId: string }) {
  const { favorites, toggle } = useFavorites();
  const active = favorites.includes(toolId);
  return (
    <button
      type="button"
      className="btn-small favorite"
      aria-pressed={active}
      title={active ? "Remove from favorites" : "Add to favorites"}
      onClick={() => toggle(toolId)}
    >
      {active ? "★ Favorite" : "☆ Favorite"}
    </button>
  );
}
