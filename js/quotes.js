// Sprüche für die Zusammenfassung nach "Training abschließen". Bewusst cheesy.
// Nur kurze, bekannte Filmzeilen sind echte Zitate (mit Film); der Rest ist "frei nach Arnold" selbst geschrieben,
// weil viele im Netz kursierende Arnold-Zitate nicht belegt sind.
export const QUOTES = [
  { text: 'I’ll be back.', source: 'Arnold Schwarzenegger, Terminator (1984)' },
  { text: 'Hasta la vista, Muskelkater.', source: 'frei nach Terminator 2' },
  { text: 'Get to the chopper! … äh, unter die Dusche.', source: 'frei nach Predator' },
  { text: 'Ich komme wieder. Mit mehr Gewicht.', source: 'frei nach Arnold' },
  { text: 'Der Pump kommt nicht vom Sofa.', source: 'frei nach Arnold' },
  { text: 'Die letzte Wiederholung ist die, die zählt.', source: 'frei nach Arnold' },
  { text: 'Heute gepumpt, morgen gewachsen.', source: 'frei nach Arnold' },
  { text: 'Gewichte lügen nicht. Und heute haben sie gesagt: stark.', source: 'frei nach Arnold' },
  { text: 'Stärker als letzte Woche. Das ist der ganze Trick.', source: 'frei nach Arnold' },
  { text: 'Kein Schmerz, kein … ach, du weißt schon.', source: 'frei nach Arnold' },
  { text: 'Muskeln wachsen nicht beim Nachdenken. Du warst da. Gut gemacht.', source: 'frei nach Arnold' },
  { text: 'Erst die Hanteln, dann das Protein. So einfach ist das.', source: 'frei nach Arnold' },
];

// Fester Spruch pro Training (gleicher Spruch bei jedem Öffnen der Zusammenfassung).
export function pickQuote(id, list = QUOTES) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return list[hash % list.length];
}
