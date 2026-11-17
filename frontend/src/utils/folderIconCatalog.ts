import fakturyIcon from '../assets/folder-icons/faktury.png';
import umowyIcon from '../assets/folder-icons/umowy.png';
import zdrowieIcon from '../assets/folder-icons/zdrowie.png';
import samochodIcon from '../assets/folder-icons/samochod.png';
import domIcon from '../assets/folder-icons/dom.png';
import pracaIcon from '../assets/folder-icons/praca.png';
import gwarancjeIcon from '../assets/folder-icons/gwarancje.png';
import osobisteIcon from '../assets/folder-icons/osobiste.png';
import budowaIcon from '../assets/folder-icons/budowa.png';
import dzieciIcon from '../assets/folder-icons/dzieci.png';
import mediaIcon from '../assets/folder-icons/media.png';
import korespondencjaIcon from '../assets/folder-icons/korespondencja.png';
import zakupyIcon from '../assets/folder-icons/zakupy.png';
import reklamacjeIcon from '../assets/folder-icons/reklamacje.png';
import hobbyIcon from '../assets/folder-icons/hobby.png';
import archiwumIcon from '../assets/folder-icons/archiwum.png';
import inboxIcon from '../assets/folder-icons/inbox.png';
import instrukcjeIcon from '../assets/folder-icons/instrukcje.png';
import certyfikatyIcon from '../assets/folder-icons/certyfikaty.png';
import szkoleniaIcon from '../assets/folder-icons/szkolenia.png';
import projektyIcon from '../assets/folder-icons/projekty.png';
import kartyIcon from '../assets/folder-icons/karty.png';
import dzialkaIcon from '../assets/folder-icons/dzialka.png';
import spadkiIcon from '../assets/folder-icons/spadki.png';
import podatkiIcon from '../assets/folder-icons/podatki.png';
import edukacjaIcon from '../assets/folder-icons/edukacja.png';
import podrozeIcon from '../assets/folder-icons/podroze.png';
import ubezpieczeniaIcon from '../assets/folder-icons/ubezpieczenia.png';
import firmaIcon from '../assets/folder-icons/firma.png';
import urzedyIcon from '../assets/folder-icons/urzedy.png';
import inwestycjeIcon from '../assets/folder-icons/inwestycje.png';
import zwierzetaIcon from '../assets/folder-icons/zwierzeta.png';
import kredytyIcon from '../assets/folder-icons/kredyty.png';
import notarialneIcon from '../assets/folder-icons/notarialne.png';
import najemIcon from '../assets/folder-icons/najem.png';
import swiadczeniaIcon from '../assets/folder-icons/swiadczenia.png';
import serwisIcon from '../assets/folder-icons/serwis.png';
import licencjeIcon from '../assets/folder-icons/licencje.png';
import dostepyIcon from '../assets/folder-icons/dostepy.png';
import pamiatkiIcon from '../assets/folder-icons/pamiatki.png';
import sejfIcon from '../assets/folder-icons/sejf.png';

export const VAULT_ICON_ID = 'preset:sejf';

export const PRESET_FOLDER_ICONS: Array<{ id: string; label: string; src: string }> = [
  { id: VAULT_ICON_ID, label: 'Sejf (pod nadzorem)', src: sejfIcon },
  { id: 'preset:faktury', label: 'Faktury i rachunki', src: fakturyIcon },
  { id: 'preset:umowy', label: 'Umowy i kontrakty', src: umowyIcon },
  { id: 'preset:zdrowie', label: 'Zdrowie i medycyna', src: zdrowieIcon },
  { id: 'preset:samochod', label: 'Samochód i pojazdy', src: samochodIcon },
  { id: 'preset:dom', label: 'Dom i mieszkanie', src: domIcon },
  { id: 'preset:praca', label: 'Praca i kariera', src: pracaIcon },
  { id: 'preset:gwarancje', label: 'Gwarancje i paragony', src: gwarancjeIcon },
  { id: 'preset:osobiste', label: 'Dokumenty osobiste', src: osobisteIcon },
  { id: 'preset:budowa', label: 'Budowa i remont', src: budowaIcon },
  { id: 'preset:dzieci', label: 'Dzieci i rodzina', src: dzieciIcon },
  { id: 'preset:media', label: 'Media i abonamenty', src: mediaIcon },
  { id: 'preset:korespondencja', label: 'Korespondencja', src: korespondencjaIcon },
  { id: 'preset:zakupy', label: 'Zakupy i zamówienia', src: zakupyIcon },
  { id: 'preset:reklamacje', label: 'Reklamacje i zwroty', src: reklamacjeIcon },
  { id: 'preset:hobby', label: 'Hobby i pasje', src: hobbyIcon },
  { id: 'preset:archiwum', label: 'Archiwum', src: archiwumIcon },
  { id: 'preset:inbox', label: 'Inbox / Do segregacji', src: inboxIcon },
  { id: 'preset:instrukcje', label: 'Instrukcje obsługi', src: instrukcjeIcon },
  { id: 'preset:certyfikaty', label: 'Certyfikaty i dyplomy', src: certyfikatyIcon },
  { id: 'preset:szkolenia', label: 'Szkolenia i kursy', src: szkoleniaIcon },
  { id: 'preset:projekty', label: 'Projekty i plany', src: projektyIcon },
  { id: 'preset:karty', label: 'Karty i lojalność', src: kartyIcon },
  { id: 'preset:dzialka', label: 'Działka i ogród', src: dzialkaIcon },
  { id: 'preset:spadki', label: 'Spadki i darowizny', src: spadkiIcon },
  { id: 'preset:podatki', label: 'Podatki i finanse', src: podatkiIcon },
  { id: 'preset:edukacja', label: 'Edukacja i szkoła', src: edukacjaIcon },
  { id: 'preset:podroze', label: 'Podróże i wyjazdy', src: podrozeIcon },
  { id: 'preset:ubezpieczenia', label: 'Ubezpieczenia', src: ubezpieczeniaIcon },
  { id: 'preset:firma', label: 'Firma i biznes', src: firmaIcon },
  { id: 'preset:urzedy', label: 'Urzędy i sądy', src: urzedyIcon },
  { id: 'preset:inwestycje', label: 'Inwestycje i oszczędności', src: inwestycjeIcon },
  { id: 'preset:zwierzeta', label: 'Zwierzęta', src: zwierzetaIcon },
  { id: 'preset:kredyty', label: 'Kredyty i hipoteki', src: kredytyIcon },
  { id: 'preset:notarialne', label: 'Akty notarialne', src: notarialneIcon },
  { id: 'preset:najem', label: 'Umowy najmu', src: najemIcon },
  { id: 'preset:swiadczenia', label: 'Świadczenia i ZUS', src: swiadczeniaIcon },
  { id: 'preset:serwis', label: 'Historia serwisowa', src: serwisIcon },
  { id: 'preset:licencje', label: 'Licencje cyfrowe', src: licencjeIcon },
  { id: 'preset:dostepy', label: 'Kody i dostępy', src: dostepyIcon },
  { id: 'preset:pamiatki', label: 'Pamiątki', src: pamiatkiIcon },
];

export const PRESET_ICON_MAP = new Map(PRESET_FOLDER_ICONS.map(item => [item.id, item.src]));

const KEYWORD_ICON_RULES: Array<{ pattern: RegExp; icon: string }> = [
  { pattern: /sejf|tajne|poufn|vault|nadz[oó]r/i, icon: VAULT_ICON_ID },
  { pattern: /kredyt|hipotek|pożyczk|pozyczk|rata/i, icon: 'preset:kredyty' },
  { pattern: /notari|akt\b|hipotecz/i, icon: 'preset:notarialne' },
  { pattern: /najem|wynaj|najm|lokator/i, icon: 'preset:najem' },
  { pattern: /świadczen|swiadczen|zus\b|emeryt|rent|500\+|800\+/i, icon: 'preset:swiadczenia' },
  { pattern: /serwis|napraw|przegląd|przeglad|warsztat/i, icon: 'preset:serwis' },
  { pattern: /licencj|klucz|serial|software|oprogramow/i, icon: 'preset:licencje' },
  { pattern: /kod|dostęp|dostep|has[lł]|pin\b|login/i, icon: 'preset:dostepy' },
  { pattern: /pamiątk|pamiatk|zdjęci|zdjeci|album|wspomnien/i, icon: 'preset:pamiatki' },
  { pattern: /podat|pit\b|vat\b|cit\b|finans|księg|ksieg|budżet|budzet/i, icon: 'preset:podatki' },
  { pattern: /faktur|rachun|opłat|oplat|przelew|bank|pieniądz|pieniadz|money/i, icon: 'preset:faktury' },
  { pattern: /ubezpiecz|polisa|ac\b|oc\b/i, icon: 'preset:ubezpieczenia' },
  { pattern: /inwest|oszczęd|oszczed|giełd|gield|akcj|obligac|lokata|krypto/i, icon: 'preset:inwestycje' },
  { pattern: /budow|remont|wykończ|wykoncz|ekipa/i, icon: 'preset:budowa' },
  { pattern: /dziec|rodzin|szkoł|przedszkol|żłob|zlob|aliment/i, icon: 'preset:dzieci' },
  { pattern: /medi|abonament|internet|telefon|tv|telewiz|netflix|spotify|prąd|prad|gaz|woda/i, icon: 'preset:media' },
  { pattern: /korespond|poczt|list|pismo|awizo/i, icon: 'preset:korespondencja' },
  { pattern: /zakup|zamów|zamow|sklep|allegro|amazon|olx/i, icon: 'preset:zakupy' },
  { pattern: /reklamac|zwrot|rękojmi|rekojmi/i, icon: 'preset:reklamacje' },
  { pattern: /hobby|pasj|sport|muzyk|bilet|koncert|malar|ryby|fish/i, icon: 'preset:hobby' },
  { pattern: /archiw|stare|historia/i, icon: 'preset:archiwum' },
  { pattern: /inbox|segreg|nowe|przychodz|skrzyn/i, icon: 'preset:inbox' },
  { pattern: /instrukc|obsług|obslug|manual|poradnik/i, icon: 'preset:instrukcje' },
  { pattern: /certyf|dyplom|uprawnien|licencj/i, icon: 'preset:certyfikaty' },
  { pattern: /szkolen|kurs|webinar|warsztat/i, icon: 'preset:szkolenia' },
  { pattern: /projekt|plan|architekt|rysun/i, icon: 'preset:projekty' },
  { pattern: /kart|lojaln|rabat|klub|vouch/i, icon: 'preset:karty' },
  { pattern: /działk|dzialk|ogród|ogrod|roślin|roslin/i, icon: 'preset:dzialka' },
  { pattern: /spad|darowizn|testament/i, icon: 'preset:spadki' },
  { pattern: /edukac|szkoł|szkol|uczel|studia|matur|egzamin/i, icon: 'preset:edukacja' },
  { pattern: /podróż|podroz|wyjazd|wakac|urlop|lot|hotel|bilet/i, icon: 'preset:podroze' },
  { pattern: /firm|biznes|działaln|dzialaln|spółk|spolk|krs|ceidg/i, icon: 'preset:firma' },
  { pattern: /urz[aąeę]d|s[aą]d|skarbow|zus|gmin|starostw|mandat/i, icon: 'preset:urzedy' },
  { pattern: /zwierz|pies|kot|weterynar|pupi/i, icon: 'preset:zwierzeta' },
  { pattern: /umow|kontrakt|akt|notar|praw|kancelar|porozum|zleceni|najm/i, icon: 'preset:umowy' },
  { pattern: /zdrow|medyc|lekar|szpital|badan|recept|wynik|chorob|dentyst/i, icon: 'preset:zdrowie' },
  { pattern: /auto|samoch|pojazd|auta|motoryz|przegląd|przeglad|paliw/i, icon: 'preset:samochod' },
  { pattern: /dom|mieszkan|nieruchom|czynsz|kredyt|hipotek/i, icon: 'preset:dom' },
  { pattern: /prac|karier|cv\b|etat|kadry|świadectw|swiadectw|wynagrodz|pensj/i, icon: 'preset:praca' },
  { pattern: /gwarancj|paragon|sprzęt|sprzet|rtv|agd|elektronik/i, icon: 'preset:gwarancje' },
  { pattern: /osobist|dowód|dowod|paszport|prawko|prawo jazdy|pesel|dokument/i, icon: 'preset:osobiste' },
];

function normalizeFoldText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ł/g, 'l');
}

const PRESET_LABEL_MAP = new Map(PRESET_FOLDER_ICONS.map(item => [item.id, item.label]));

const PREFIX_ICON_RULES = KEYWORD_ICON_RULES.map(rule => {
  const cleanedSource = rule.pattern.source
    .replace(/\[[^\]]+\]/g, m => m[1] || '')
    .replace(/\\b|\\\+/g, '');
  const patternTokens = cleanedSource.split('|').map(normalizeFoldText);
  const labelTokens = normalizeFoldText(PRESET_LABEL_MAP.get(rule.icon) || '')
    .split(/[^a-z0-9]+/)
    .filter(t => t.length >= 3);
  return { icon: rule.icon, tokens: [...new Set([...patternTokens, ...labelTokens])].filter(t => t.length >= 3) };
});

/** Suggests a folder icon based on Polish/English keywords or 3+ letter prefixes in the folder name. */
export function suggestFolderIcon(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '📁';
  const exact = KEYWORD_ICON_RULES.find(rule => rule.pattern.test(trimmed));
  if (exact) return exact.icon;
  const words = normalizeFoldText(trimmed).split(/[^a-z0-9]+/).filter(w => w.length >= 3);
  for (const word of words) {
    const prefixMatch = PREFIX_ICON_RULES.find(rule => rule.tokens.some(token => token.startsWith(word)));
    if (prefixMatch) return prefixMatch.icon;
  }
  return '📁';
}
