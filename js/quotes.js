// Zitate für die Zusammenfassung nach "Training abschließen": Arnold, Ali und Bruce Lee,
// ausgewählt nach "passt nach dem Training" (teils selbst übersetzt, teils vom Nutzer vorgegeben). "belegt" = aus Film/Interview bekannt,
// sonst nur zugeschrieben (viele Netz-Zitate sind nicht sicher belegt).
export const AUTHORS = {
  arnold: {
    name: 'Arnold Schwarzenegger',
    // Hantel
    icon: '<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="9" y="22" width="30" height="4" rx="2"/>'
      + '<rect x="11" y="13" width="6" height="22" rx="2"/><rect x="31" y="13" width="6" height="22" rx="2"/>'
      + '<rect x="5" y="17" width="5" height="14" rx="2"/><rect x="38" y="17" width="5" height="14" rx="2"/></svg>',
  },
  ali: {
    name: 'Muhammad Ali',
    // Boxhandschuh
    icon: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M13 19c0-10 6-15 15-15s14 6 14 15v9c0 6-4 9-9 9H19c-4 0-6-3-6-7z"/>'
      + '<ellipse cx="10" cy="27" rx="5" ry="7"/><rect x="16" y="38" width="24" height="7" rx="2"/></svg>',
  },
  lee: {
    name: 'Bruce Lee',
    // Nunchaku
    icon: '<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="7" y="15" width="8" height="29" rx="4" transform="rotate(-18 11 29.5)"/>'
      + '<rect x="33" y="15" width="8" height="29" rx="4" transform="rotate(18 37 29.5)"/>'
      + '<path d="M15 15 Q24 1 33 15" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>',
  },
};

export const QUOTES = [
  // Arnold Schwarzenegger
  { author: 'arnold', text: 'Die letzten drei, vier Wiederholungen lassen den Muskel wachsen.', source: 'Pumping Iron (1977), sinngemäß' },
  { author: 'arnold', text: 'Der Kopf ist die Grenze.', source: 'Pumping Iron (1977)' },
  { author: 'arnold', text: 'Der Pump ist das beste Gefühl, das es gibt.', source: 'Pumping Iron (1977), sinngemäß' },
  { author: 'arnold', text: 'Milch ist für Babys. Wenn du groß bist, trinkst du Bier.', source: 'Pumping Iron (1977)' },
  { author: 'arnold', text: 'I’ll be back.', source: 'Terminator (1984)' },
  { author: 'arnold', text: 'Hasta la vista, Baby.', source: 'Terminator 2 (1991)' },
  { author: 'arnold', text: 'Stärke kommt nicht vom Gewinnen. Deine Kämpfe entwickeln deine Stärke.', source: 'zugeschrieben' },
  { author: 'arnold', text: 'Mit den Händen in den Hosentaschen kommt man keine Leiter hoch.', source: 'zugeschrieben' },
  { author: 'arnold', text: 'Der Widerstand, den du physisch im Trainingsraum bekämpfst, und der Widerstand, gegen den du im Leben kämpfst, können nur einen starken Charakter hervorbringen.', source: 'zugeschrieben' },
  { author: 'arnold', text: 'Wir alle haben große Kraft in uns. Diese Kraft ist der Glaube an sich selbst. Es gibt wirklich eine Einstellung des Gewinnens. Du musst dich gewinnen sehen, bevor du gewinnst. Und du musst hungrig sein. Du musst erobern wollen.', source: 'zugeschrieben' },
  { author: 'arnold', text: 'Ich wollte diesen Körper, und es interessierte mich nicht, was ich dafür tun musste.', source: 'zugeschrieben' },
  { author: 'arnold', text: 'Das Schlimmste, was ich sein kann, ist so wie alle anderen.', source: 'zugeschrieben' },
  // Muhammad Ali
  { author: 'ali', text: 'Schwebe wie ein Schmetterling, stich wie eine Biene.', source: '1964' },
  { author: 'ali', text: 'Ich bin der Größte!', source: '1964' },
  { author: 'ali', text: 'Ich habe jede Minute Training gehasst. Aber ich sagte mir: Gib nicht auf. Leide jetzt und lebe als Champion.', source: 'zugeschrieben' },
  { author: 'ali', text: 'Ich zähle meine Sit-ups erst, wenn es wehtut. Nur die zählen.', source: 'zugeschrieben' },
  { author: 'ali', text: 'Der Kampf wird fern aller Zuschauer gewonnen – im Gym, lange bevor ich unter den Lichtern tanze.', source: 'zugeschrieben, gekürzt' },
  { author: 'ali', text: 'Champions entstehen nicht im Gym. Sie entstehen aus etwas tief in ihnen drin.', source: 'zugeschrieben, gekürzt' },
  { author: 'ali', text: 'Zähl nicht die Tage. Mach, dass die Tage zählen.', source: 'zugeschrieben' },
  { author: 'ali', text: 'Unmöglich ist nichts.', source: 'zugeschrieben' },
  { author: 'ali', text: 'Wer nicht mutig genug ist, etwas zu riskieren, wird nichts erreichen.', source: 'zugeschrieben' },
  { author: 'ali', text: 'Wenn mein Kopf es sich ausdenken kann, wenn mein Herz daran glauben kann, dann kann ich es auch erreichen.', source: 'zugeschrieben' },
  { author: 'ali', text: 'Ich bin so schnell: Ich mache das Licht aus und liege im Bett, bevor es dunkel ist.', source: 'zugeschrieben' },
  // Bruce Lee
  { author: 'lee', text: 'Sei Wasser, mein Freund.', source: 'Longstreet (1971)' },
  { author: 'lee', text: 'Denk nicht – fühle!', source: 'Der Mann mit der Todeskralle (1973)' },
  { author: 'lee', text: 'Ich fürchte nicht den, der 10.000 Kicks einmal geübt hat, sondern den, der einen Kick 10.000-mal geübt hat.', source: 'zugeschrieben' },
  { author: 'lee', text: 'Es gibt keine Grenzen, nur Plateaus. Und auf denen darfst du nicht stehen bleiben.', source: 'zugeschrieben' },
  { author: 'lee', text: 'Wissen genügt nicht, man muss es anwenden. Wollen genügt nicht, man muss es tun.', source: 'zugeschrieben' },
  { author: 'lee', text: 'Wünsch dir kein leichtes Leben. Wünsch dir die Kraft, ein schweres zu meistern.', source: 'zugeschrieben' },
  { author: 'lee', text: 'Nimm, was nützt, verwirf, was nicht nützt, und füge hinzu, was dein Eigenes ist.', source: 'zugeschrieben' },
  { author: 'lee', text: 'Nicht das Scheitern ist das Verbrechen, sondern ein zu niedriges Ziel.', source: 'zugeschrieben' },
  { author: 'lee', text: 'Wer zu lange über eine Sache nachdenkt, wird sie nie erledigen.', source: 'zugeschrieben' },
  { author: 'lee', text: 'Sei immer du selbst, drück dich aus, glaub an dich.', source: 'zugeschrieben' },
  { author: 'lee', text: 'Besser langsam und richtig als schnell und falsch.', source: 'zugeschrieben' },
  { author: 'lee', text: 'Man kann dir den Weg weisen, aber gehen musst du ihn selbst.', source: 'zugeschrieben' },
  { author: 'lee', text: 'Wer den Erfolg will, sollte lernen zu kämpfen und sich alle Mühe geben, auch zu leiden.', source: 'zugeschrieben' },
];

// Anzeige der Quelle: Nur zugeschriebene Zitate bekommen ein augenzwinkerndes "(vielleicht)".
export function sourceLabel(q) {
  if (!q.source.startsWith('zugeschrieben')) return q.source;
  const rest = q.source.replace(/^zugeschrieben,?\s*/, '');
  return '(vielleicht' + (rest ? ', ' + rest : '') + ')';
}

// Fester Spruch pro Training (gleicher Spruch bei jedem Öffnen der Zusammenfassung).
export function pickQuote(id, list = QUOTES) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return list[hash % list.length];
}
