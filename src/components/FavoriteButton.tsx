import { ToggleButton } from "@fluentui/react-components";
import { Star16Filled, Star16Regular } from "@fluentui/react-icons";
import { useFavorites } from "../lib/useUserLists";

export function FavoriteButton({ toolId }: { toolId: string }) {
  const { favorites, toggle } = useFavorites();
  const active = favorites.includes(toolId);
  return (
    <ToggleButton
      size="small"
      className="favorite"
      appearance={active ? "primary" : "outline"}
      checked={active}
      icon={active ? <Star16Filled /> : <Star16Regular />}
      title={active ? "Remove from favorites" : "Add to favorites"}
      onClick={() => toggle(toolId)}
    >
      {active ? "Favorite" : "Favorite"}
    </ToggleButton>
  );
}
