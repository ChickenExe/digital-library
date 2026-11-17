/**
 * Artwork for the Holy Scripture edition. All public domain / CC0, from
 * Wikimedia Commons; sources in src/assets/editions/orthodox/CREDITS.md.
 */
import pantocrator from "../../assets/editions/orthodox/pantocrator.jpg";
import trinity from "../../assets/editions/orthodox/trinity.jpg";
import cross from "../../assets/editions/orthodox/cross.png";
import nicholas from "../../assets/editions/orthodox/nicholas.jpg";
import michael from "../../assets/editions/orthodox/michael.webp";

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
  nicholas: {
    src: nicholas,
    title: "St Nicholas of Myra",
    caption: "Icon · St Catherine’s Monastery, Sinai · 13th century",
  },
  michael: {
    src: michael,
    title: "The Archangel Michael",
    caption: "Icon · Constantinople · 14th century",
  },
  /** The three-bar Orthodox cross, bone white on transparent (for decals). */
  cross,
};
