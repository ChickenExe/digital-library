/**
 * Artwork for the Holy Scripture edition. All public domain / CC0, from
 * Wikimedia Commons; sources in src/assets/editions/orthodox/CREDITS.md.
 */
import pantocrator from "../../assets/editions/orthodox/pantocrator.jpg";
import trinity from "../../assets/editions/orthodox/trinity.jpg";
import cross from "../../assets/editions/orthodox/cross.png";

export const ART = {
  pantocrator: {
    src: pantocrator,
    title: "Christ Pantocrator",
    caption: "Encaustic icon · St Catherine’s Monastery, Sinai · 6th century",
  },
  trinity: {
    src: trinity,
    title: "The Holy Trinity",
    caption: "Andrei Rublev · Tempera on panel · c. 1411",
  },
  /** The three-bar Orthodox cross, bone white on transparent (for decals). */
  cross,
};
