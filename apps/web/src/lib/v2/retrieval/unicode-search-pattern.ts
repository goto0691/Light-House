/**
 * SQLite substring GLOB patterns with Unicode default simple case folding.
 *
 * Generated from Unicode 16.0.0 CaseFolding.txt, status C/S only (not F/T).
 * Source: https://www.unicode.org/Public/16.0.0/ucd/CaseFolding.txt
 * Source bytes: 86092; SHA-256: 6f1f9c588eb4a5c718d9e8f93b782685e5c7fec872cf05e8e6878053599e09bb
 * Generation: union each C/S source and target; sort code points in every
 * connected component, then sort components by their first code point.
 * 1484 edges; 1454 classes; 2938 code points; at most 4 code points/class.
 * Classes joined by one ASCII space, UTF-8 SHA-256:
 * b97ebbdf941cb23d8e96c61df3a97934620390509c05ae0587315b2fd0fb3335
 *
 * No runtime Unicode scan, locale folding, normalization or string lowercasing.
 * Regenerate from the pinned source and review RegExp /iu parity on an engine
 * Unicode-data upgrade; do not substitute full or Turkic case folding.
 *
 * The following notice covers the generated Unicode data.
 * UNICODE LICENSE V3
 * 
 * COPYRIGHT AND PERMISSION NOTICE
 * 
 * Copyright © 1991-2026 Unicode, Inc.
 * 
 * NOTICE TO USER: Carefully read the following legal agreement. BY
 * DOWNLOADING, INSTALLING, COPYING OR OTHERWISE USING DATA FILES, AND/OR
 * SOFTWARE, YOU UNEQUIVOCALLY ACCEPT, AND AGREE TO BE BOUND BY, ALL OF THE
 * TERMS AND CONDITIONS OF THIS AGREEMENT. IF YOU DO NOT AGREE, DO NOT
 * DOWNLOAD, INSTALL, COPY, DISTRIBUTE OR USE THE DATA FILES OR SOFTWARE.
 * 
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of data files and any associated documentation (the "Data Files") or
 * software and any associated documentation (the "Software") to deal in the
 * Data Files or Software without restriction, including without limitation
 * the rights to use, copy, modify, merge, publish, distribute, and/or sell
 * copies of the Data Files or Software, and to permit persons to whom the
 * Data Files or Software are furnished to do so, provided that either (a)
 * this copyright and permission notice appear with all copies of the Data
 * Files or Software, or (b) this copyright and permission notice appear in
 * associated Documentation.
 * 
 * THE DATA FILES AND SOFTWARE ARE PROVIDED "AS IS", WITHOUT WARRANTY OF ANY
 * KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
 * MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT OF
 * THIRD PARTY RIGHTS.
 * 
 * IN NO EVENT SHALL THE COPYRIGHT HOLDER OR HOLDERS INCLUDED IN THIS NOTICE
 * BE LIABLE FOR ANY CLAIM, OR ANY SPECIAL INDIRECT OR CONSEQUENTIAL DAMAGES,
 * OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS,
 * WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION,
 * ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THE DATA
 * FILES OR SOFTWARE.
 * 
 * Except as contained in this notice, the name of a copyright holder shall
 * not be used in advertising or otherwise to promote the sale, use or other
 * dealings in these Data Files or Software without prior written
 * authorization of the copyright holder.
 */

// BEGIN GENERATED UNICODE 16.0.0 SIMPLE CASE FOLD CLASSES
const SIMPLE_CASE_FOLD_GROUPS = [
  "Aa", "Bb", "Cc", "Dd", "Ee", "Ff", "Gg", "Hh", "Ii", "Jj", "KkK", "Ll",
  "Mm", "Nn", "Oo", "Pp", "Qq", "Rr", "Ssſ", "Tt", "Uu", "Vv", "Ww", "Xx",
  "Yy", "Zz", "µΜμ", "Àà", "Áá", "Ââ", "Ãã", "Ää", "ÅåÅ", "Ææ", "Çç", "Èè",
  "Éé", "Êê", "Ëë", "Ìì", "Íí", "Îî", "Ïï", "Ðð", "Ññ", "Òò", "Óó", "Ôô",
  "Õõ", "Öö", "Øø", "Ùù", "Úú", "Ûû", "Üü", "Ýý", "Þþ", "ßẞ", "ÿŸ", "Āā",
  "Ăă", "Ąą", "Ćć", "Ĉĉ", "Ċċ", "Čč", "Ďď", "Đđ", "Ēē", "Ĕĕ", "Ėė", "Ęę",
  "Ěě", "Ĝĝ", "Ğğ", "Ġġ", "Ģģ", "Ĥĥ", "Ħħ", "Ĩĩ", "Īī", "Ĭĭ", "Įį", "Ĳĳ",
  "Ĵĵ", "Ķķ", "Ĺĺ", "Ļļ", "Ľľ", "Ŀŀ", "Łł", "Ńń", "Ņņ", "Ňň", "Ŋŋ", "Ōō",
  "Ŏŏ", "Őő", "Œœ", "Ŕŕ", "Ŗŗ", "Řř", "Śś", "Ŝŝ", "Şş", "Šš", "Ţţ", "Ťť",
  "Ŧŧ", "Ũũ", "Ūū", "Ŭŭ", "Ůů", "Űű", "Ųų", "Ŵŵ", "Ŷŷ", "Źź", "Żż", "Žž",
  "ƀɃ", "Ɓɓ", "Ƃƃ", "Ƅƅ", "Ɔɔ", "Ƈƈ", "Ɖɖ", "Ɗɗ", "Ƌƌ", "Ǝǝ", "Əə", "Ɛɛ",
  "Ƒƒ", "Ɠɠ", "Ɣɣ", "ƕǶ", "Ɩɩ", "Ɨɨ", "Ƙƙ", "ƚȽ", "ƛꟜ", "Ɯɯ", "Ɲɲ", "ƞȠ",
  "Ɵɵ", "Ơơ", "Ƣƣ", "Ƥƥ", "Ʀʀ", "Ƨƨ", "Ʃʃ", "Ƭƭ", "Ʈʈ", "Ưư", "Ʊʊ", "Ʋʋ",
  "Ƴƴ", "Ƶƶ", "Ʒʒ", "Ƹƹ", "Ƽƽ", "ƿǷ", "Ǆǅǆ", "Ǉǈǉ", "Ǌǋǌ", "Ǎǎ", "Ǐǐ", "Ǒǒ",
  "Ǔǔ", "Ǖǖ", "Ǘǘ", "Ǚǚ", "Ǜǜ", "Ǟǟ", "Ǡǡ", "Ǣǣ", "Ǥǥ", "Ǧǧ", "Ǩǩ", "Ǫǫ",
  "Ǭǭ", "Ǯǯ", "Ǳǲǳ", "Ǵǵ", "Ǹǹ", "Ǻǻ", "Ǽǽ", "Ǿǿ", "Ȁȁ", "Ȃȃ", "Ȅȅ", "Ȇȇ",
  "Ȉȉ", "Ȋȋ", "Ȍȍ", "Ȏȏ", "Ȑȑ", "Ȓȓ", "Ȕȕ", "Ȗȗ", "Șș", "Țț", "Ȝȝ", "Ȟȟ",
  "Ȣȣ", "Ȥȥ", "Ȧȧ", "Ȩȩ", "Ȫȫ", "Ȭȭ", "Ȯȯ", "Ȱȱ", "Ȳȳ", "Ⱥⱥ", "Ȼȼ", "Ⱦⱦ",
  "ȿⱾ", "ɀⱿ", "Ɂɂ", "Ʉʉ", "Ʌʌ", "Ɇɇ", "Ɉɉ", "Ɋɋ", "Ɍɍ", "Ɏɏ", "ɐⱯ", "ɑⱭ",
  "ɒⱰ", "ɜꞫ", "ɡꞬ", "ɤꟋ", "ɥꞍ", "ɦꞪ", "ɪꞮ", "ɫⱢ", "ɬꞭ", "ɱⱮ", "ɽⱤ", "ʂꟅ",
  "ʇꞱ", "ʝꞲ", "ʞꞰ", "ͅΙιι", "Ͱͱ", "Ͳͳ", "Ͷͷ", "ͻϽ", "ͼϾ", "ͽϿ", "Ϳϳ", "Άά",
  "Έέ", "Ήή", "Ίί", "Όό", "Ύύ", "Ώώ", "ΐΐ", "Αα", "Ββϐ", "Γγ", "Δδ", "Εεϵ",
  "Ζζ", "Ηη", "Θθϑϴ", "Κκϰ", "Λλ", "Νν", "Ξξ", "Οο", "Ππϖ", "Ρρϱ", "Σςσ", "Ττ",
  "Υυ", "Φφϕ", "Χχ", "Ψψ", "ΩωΩ", "Ϊϊ", "Ϋϋ", "ΰΰ", "Ϗϗ", "Ϙϙ", "Ϛϛ", "Ϝϝ",
  "Ϟϟ", "Ϡϡ", "Ϣϣ", "Ϥϥ", "Ϧϧ", "Ϩϩ", "Ϫϫ", "Ϭϭ", "Ϯϯ", "ϲϹ", "Ϸϸ", "Ϻϻ",
  "Ѐѐ", "Ёё", "Ђђ", "Ѓѓ", "Єє", "Ѕѕ", "Іі", "Її", "Јј", "Љљ", "Њњ", "Ћћ",
  "Ќќ", "Ѝѝ", "Ўў", "Џџ", "Аа", "Бб", "Ввᲀ", "Гг", "Ддᲁ", "Ее", "Жж", "Зз",
  "Ии", "Йй", "Кк", "Лл", "Мм", "Нн", "Ооᲂ", "Пп", "Рр", "Ссᲃ", "Ттᲄᲅ", "Уу",
  "Фф", "Хх", "Цц", "Чч", "Шш", "Щщ", "Ъъᲆ", "Ыы", "Ьь", "Ээ", "Юю", "Яя",
  "Ѡѡ", "Ѣѣᲇ", "Ѥѥ", "Ѧѧ", "Ѩѩ", "Ѫѫ", "Ѭѭ", "Ѯѯ", "Ѱѱ", "Ѳѳ", "Ѵѵ", "Ѷѷ",
  "Ѹѹ", "Ѻѻ", "Ѽѽ", "Ѿѿ", "Ҁҁ", "Ҋҋ", "Ҍҍ", "Ҏҏ", "Ґґ", "Ғғ", "Ҕҕ", "Җҗ",
  "Ҙҙ", "Ққ", "Ҝҝ", "Ҟҟ", "Ҡҡ", "Ңң", "Ҥҥ", "Ҧҧ", "Ҩҩ", "Ҫҫ", "Ҭҭ", "Үү",
  "Ұұ", "Ҳҳ", "Ҵҵ", "Ҷҷ", "Ҹҹ", "Һһ", "Ҽҽ", "Ҿҿ", "Ӏӏ", "Ӂӂ", "Ӄӄ", "Ӆӆ",
  "Ӈӈ", "Ӊӊ", "Ӌӌ", "Ӎӎ", "Ӑӑ", "Ӓӓ", "Ӕӕ", "Ӗӗ", "Әә", "Ӛӛ", "Ӝӝ", "Ӟӟ",
  "Ӡӡ", "Ӣӣ", "Ӥӥ", "Ӧӧ", "Өө", "Ӫӫ", "Ӭӭ", "Ӯӯ", "Ӱӱ", "Ӳӳ", "Ӵӵ", "Ӷӷ",
  "Ӹӹ", "Ӻӻ", "Ӽӽ", "Ӿӿ", "Ԁԁ", "Ԃԃ", "Ԅԅ", "Ԇԇ", "Ԉԉ", "Ԋԋ", "Ԍԍ", "Ԏԏ",
  "Ԑԑ", "Ԓԓ", "Ԕԕ", "Ԗԗ", "Ԙԙ", "Ԛԛ", "Ԝԝ", "Ԟԟ", "Ԡԡ", "Ԣԣ", "Ԥԥ", "Ԧԧ",
  "Ԩԩ", "Ԫԫ", "Ԭԭ", "Ԯԯ", "Աա", "Բբ", "Գգ", "Դդ", "Եե", "Զզ", "Էէ", "Ըը",
  "Թթ", "Ժժ", "Իի", "Լլ", "Խխ", "Ծծ", "Կկ", "Հհ", "Ձձ", "Ղղ", "Ճճ", "Մմ",
  "Յյ", "Նն", "Շշ", "Ոո", "Չչ", "Պպ", "Ջջ", "Ռռ", "Սս", "Վվ", "Տտ", "Րր",
  "Ցց", "Ււ", "Փփ", "Քք", "Օօ", "Ֆֆ", "Ⴀⴀ", "Ⴁⴁ", "Ⴂⴂ", "Ⴃⴃ", "Ⴄⴄ", "Ⴅⴅ",
  "Ⴆⴆ", "Ⴇⴇ", "Ⴈⴈ", "Ⴉⴉ", "Ⴊⴊ", "Ⴋⴋ", "Ⴌⴌ", "Ⴍⴍ", "Ⴎⴎ", "Ⴏⴏ", "Ⴐⴐ", "Ⴑⴑ",
  "Ⴒⴒ", "Ⴓⴓ", "Ⴔⴔ", "Ⴕⴕ", "Ⴖⴖ", "Ⴗⴗ", "Ⴘⴘ", "Ⴙⴙ", "Ⴚⴚ", "Ⴛⴛ", "Ⴜⴜ", "Ⴝⴝ",
  "Ⴞⴞ", "Ⴟⴟ", "Ⴠⴠ", "Ⴡⴡ", "Ⴢⴢ", "Ⴣⴣ", "Ⴤⴤ", "Ⴥⴥ", "Ⴧⴧ", "Ⴭⴭ", "აᲐ", "ბᲑ",
  "გᲒ", "დᲓ", "ეᲔ", "ვᲕ", "ზᲖ", "თᲗ", "იᲘ", "კᲙ", "ლᲚ", "მᲛ", "ნᲜ", "ოᲝ",
  "პᲞ", "ჟᲟ", "რᲠ", "სᲡ", "ტᲢ", "უᲣ", "ფᲤ", "ქᲥ", "ღᲦ", "ყᲧ", "შᲨ", "ჩᲩ",
  "ცᲪ", "ძᲫ", "წᲬ", "ჭᲭ", "ხᲮ", "ჯᲯ", "ჰᲰ", "ჱᲱ", "ჲᲲ", "ჳᲳ", "ჴᲴ", "ჵᲵ",
  "ჶᲶ", "ჷᲷ", "ჸᲸ", "ჹᲹ", "ჺᲺ", "ჽᲽ", "ჾᲾ", "ჿᲿ", "Ꭰꭰ", "Ꭱꭱ", "Ꭲꭲ", "Ꭳꭳ",
  "Ꭴꭴ", "Ꭵꭵ", "Ꭶꭶ", "Ꭷꭷ", "Ꭸꭸ", "Ꭹꭹ", "Ꭺꭺ", "Ꭻꭻ", "Ꭼꭼ", "Ꭽꭽ", "Ꭾꭾ", "Ꭿꭿ",
  "Ꮀꮀ", "Ꮁꮁ", "Ꮂꮂ", "Ꮃꮃ", "Ꮄꮄ", "Ꮅꮅ", "Ꮆꮆ", "Ꮇꮇ", "Ꮈꮈ", "Ꮉꮉ", "Ꮊꮊ", "Ꮋꮋ",
  "Ꮌꮌ", "Ꮍꮍ", "Ꮎꮎ", "Ꮏꮏ", "Ꮐꮐ", "Ꮑꮑ", "Ꮒꮒ", "Ꮓꮓ", "Ꮔꮔ", "Ꮕꮕ", "Ꮖꮖ", "Ꮗꮗ",
  "Ꮘꮘ", "Ꮙꮙ", "Ꮚꮚ", "Ꮛꮛ", "Ꮜꮜ", "Ꮝꮝ", "Ꮞꮞ", "Ꮟꮟ", "Ꮠꮠ", "Ꮡꮡ", "Ꮢꮢ", "Ꮣꮣ",
  "Ꮤꮤ", "Ꮥꮥ", "Ꮦꮦ", "Ꮧꮧ", "Ꮨꮨ", "Ꮩꮩ", "Ꮪꮪ", "Ꮫꮫ", "Ꮬꮬ", "Ꮭꮭ", "Ꮮꮮ", "Ꮯꮯ",
  "Ꮰꮰ", "Ꮱꮱ", "Ꮲꮲ", "Ꮳꮳ", "Ꮴꮴ", "Ꮵꮵ", "Ꮶꮶ", "Ꮷꮷ", "Ꮸꮸ", "Ꮹꮹ", "Ꮺꮺ", "Ꮻꮻ",
  "Ꮼꮼ", "Ꮽꮽ", "Ꮾꮾ", "Ꮿꮿ", "Ᏸᏸ", "Ᏹᏹ", "Ᏺᏺ", "Ᏻᏻ", "Ᏼᏼ", "Ᏽᏽ", "ᲈꙊꙋ", "Ᲊᲊ",
  "ᵹꝽ", "ᵽⱣ", "ᶎꟆ", "Ḁḁ", "Ḃḃ", "Ḅḅ", "Ḇḇ", "Ḉḉ", "Ḋḋ", "Ḍḍ", "Ḏḏ", "Ḑḑ",
  "Ḓḓ", "Ḕḕ", "Ḗḗ", "Ḙḙ", "Ḛḛ", "Ḝḝ", "Ḟḟ", "Ḡḡ", "Ḣḣ", "Ḥḥ", "Ḧḧ", "Ḩḩ",
  "Ḫḫ", "Ḭḭ", "Ḯḯ", "Ḱḱ", "Ḳḳ", "Ḵḵ", "Ḷḷ", "Ḹḹ", "Ḻḻ", "Ḽḽ", "Ḿḿ", "Ṁṁ",
  "Ṃṃ", "Ṅṅ", "Ṇṇ", "Ṉṉ", "Ṋṋ", "Ṍṍ", "Ṏṏ", "Ṑṑ", "Ṓṓ", "Ṕṕ", "Ṗṗ", "Ṙṙ",
  "Ṛṛ", "Ṝṝ", "Ṟṟ", "Ṡṡẛ", "Ṣṣ", "Ṥṥ", "Ṧṧ", "Ṩṩ", "Ṫṫ", "Ṭṭ", "Ṯṯ", "Ṱṱ",
  "Ṳṳ", "Ṵṵ", "Ṷṷ", "Ṹṹ", "Ṻṻ", "Ṽṽ", "Ṿṿ", "Ẁẁ", "Ẃẃ", "Ẅẅ", "Ẇẇ", "Ẉẉ",
  "Ẋẋ", "Ẍẍ", "Ẏẏ", "Ẑẑ", "Ẓẓ", "Ẕẕ", "Ạạ", "Ảả", "Ấấ", "Ầầ", "Ẩẩ", "Ẫẫ",
  "Ậậ", "Ắắ", "Ằằ", "Ẳẳ", "Ẵẵ", "Ặặ", "Ẹẹ", "Ẻẻ", "Ẽẽ", "Ếế", "Ềề", "Ểể",
  "Ễễ", "Ệệ", "Ỉỉ", "Ịị", "Ọọ", "Ỏỏ", "Ốố", "Ồồ", "Ổổ", "Ỗỗ", "Ộộ", "Ớớ",
  "Ờờ", "Ởở", "Ỡỡ", "Ợợ", "Ụụ", "Ủủ", "Ứứ", "Ừừ", "Ửử", "Ữữ", "Ựự", "Ỳỳ",
  "Ỵỵ", "Ỷỷ", "Ỹỹ", "Ỻỻ", "Ỽỽ", "Ỿỿ", "ἀἈ", "ἁἉ", "ἂἊ", "ἃἋ", "ἄἌ", "ἅἍ",
  "ἆἎ", "ἇἏ", "ἐἘ", "ἑἙ", "ἒἚ", "ἓἛ", "ἔἜ", "ἕἝ", "ἠἨ", "ἡἩ", "ἢἪ", "ἣἫ",
  "ἤἬ", "ἥἭ", "ἦἮ", "ἧἯ", "ἰἸ", "ἱἹ", "ἲἺ", "ἳἻ", "ἴἼ", "ἵἽ", "ἶἾ", "ἷἿ",
  "ὀὈ", "ὁὉ", "ὂὊ", "ὃὋ", "ὄὌ", "ὅὍ", "ὑὙ", "ὓὛ", "ὕὝ", "ὗὟ", "ὠὨ", "ὡὩ",
  "ὢὪ", "ὣὫ", "ὤὬ", "ὥὭ", "ὦὮ", "ὧὯ", "ὰᾺ", "άΆ", "ὲῈ", "έΈ", "ὴῊ", "ήΉ",
  "ὶῚ", "ίΊ", "ὸῸ", "όΌ", "ὺῪ", "ύΎ", "ὼῺ", "ώΏ", "ᾀᾈ", "ᾁᾉ", "ᾂᾊ", "ᾃᾋ",
  "ᾄᾌ", "ᾅᾍ", "ᾆᾎ", "ᾇᾏ", "ᾐᾘ", "ᾑᾙ", "ᾒᾚ", "ᾓᾛ", "ᾔᾜ", "ᾕᾝ", "ᾖᾞ", "ᾗᾟ",
  "ᾠᾨ", "ᾡᾩ", "ᾢᾪ", "ᾣᾫ", "ᾤᾬ", "ᾥᾭ", "ᾦᾮ", "ᾧᾯ", "ᾰᾸ", "ᾱᾹ", "ᾳᾼ", "ῃῌ",
  "ῐῘ", "ῑῙ", "ῠῨ", "ῡῩ", "ῥῬ", "ῳῼ", "Ⅎⅎ", "Ⅰⅰ", "Ⅱⅱ", "Ⅲⅲ", "Ⅳⅳ", "Ⅴⅴ",
  "Ⅵⅵ", "Ⅶⅶ", "Ⅷⅷ", "Ⅸⅸ", "Ⅹⅹ", "Ⅺⅺ", "Ⅻⅻ", "Ⅼⅼ", "Ⅽⅽ", "Ⅾⅾ", "Ⅿⅿ", "Ↄↄ",
  "Ⓐⓐ", "Ⓑⓑ", "Ⓒⓒ", "Ⓓⓓ", "Ⓔⓔ", "Ⓕⓕ", "Ⓖⓖ", "Ⓗⓗ", "Ⓘⓘ", "Ⓙⓙ", "Ⓚⓚ", "Ⓛⓛ",
  "Ⓜⓜ", "Ⓝⓝ", "Ⓞⓞ", "Ⓟⓟ", "Ⓠⓠ", "Ⓡⓡ", "Ⓢⓢ", "Ⓣⓣ", "Ⓤⓤ", "Ⓥⓥ", "Ⓦⓦ", "Ⓧⓧ",
  "Ⓨⓨ", "Ⓩⓩ", "Ⰰⰰ", "Ⰱⰱ", "Ⰲⰲ", "Ⰳⰳ", "Ⰴⰴ", "Ⰵⰵ", "Ⰶⰶ", "Ⰷⰷ", "Ⰸⰸ", "Ⰹⰹ",
  "Ⰺⰺ", "Ⰻⰻ", "Ⰼⰼ", "Ⰽⰽ", "Ⰾⰾ", "Ⰿⰿ", "Ⱀⱀ", "Ⱁⱁ", "Ⱂⱂ", "Ⱃⱃ", "Ⱄⱄ", "Ⱅⱅ",
  "Ⱆⱆ", "Ⱇⱇ", "Ⱈⱈ", "Ⱉⱉ", "Ⱊⱊ", "Ⱋⱋ", "Ⱌⱌ", "Ⱍⱍ", "Ⱎⱎ", "Ⱏⱏ", "Ⱐⱐ", "Ⱑⱑ",
  "Ⱒⱒ", "Ⱓⱓ", "Ⱔⱔ", "Ⱕⱕ", "Ⱖⱖ", "Ⱗⱗ", "Ⱘⱘ", "Ⱙⱙ", "Ⱚⱚ", "Ⱛⱛ", "Ⱜⱜ", "Ⱝⱝ",
  "Ⱞⱞ", "Ⱟⱟ", "Ⱡⱡ", "Ⱨⱨ", "Ⱪⱪ", "Ⱬⱬ", "Ⱳⱳ", "Ⱶⱶ", "Ⲁⲁ", "Ⲃⲃ", "Ⲅⲅ", "Ⲇⲇ",
  "Ⲉⲉ", "Ⲋⲋ", "Ⲍⲍ", "Ⲏⲏ", "Ⲑⲑ", "Ⲓⲓ", "Ⲕⲕ", "Ⲗⲗ", "Ⲙⲙ", "Ⲛⲛ", "Ⲝⲝ", "Ⲟⲟ",
  "Ⲡⲡ", "Ⲣⲣ", "Ⲥⲥ", "Ⲧⲧ", "Ⲩⲩ", "Ⲫⲫ", "Ⲭⲭ", "Ⲯⲯ", "Ⲱⲱ", "Ⲳⲳ", "Ⲵⲵ", "Ⲷⲷ",
  "Ⲹⲹ", "Ⲻⲻ", "Ⲽⲽ", "Ⲿⲿ", "Ⳁⳁ", "Ⳃⳃ", "Ⳅⳅ", "Ⳇⳇ", "Ⳉⳉ", "Ⳋⳋ", "Ⳍⳍ", "Ⳏⳏ",
  "Ⳑⳑ", "Ⳓⳓ", "Ⳕⳕ", "Ⳗⳗ", "Ⳙⳙ", "Ⳛⳛ", "Ⳝⳝ", "Ⳟⳟ", "Ⳡⳡ", "Ⳣⳣ", "Ⳬⳬ", "Ⳮⳮ",
  "Ⳳⳳ", "Ꙁꙁ", "Ꙃꙃ", "Ꙅꙅ", "Ꙇꙇ", "Ꙉꙉ", "Ꙍꙍ", "Ꙏꙏ", "Ꙑꙑ", "Ꙓꙓ", "Ꙕꙕ", "Ꙗꙗ",
  "Ꙙꙙ", "Ꙛꙛ", "Ꙝꙝ", "Ꙟꙟ", "Ꙡꙡ", "Ꙣꙣ", "Ꙥꙥ", "Ꙧꙧ", "Ꙩꙩ", "Ꙫꙫ", "Ꙭꙭ", "Ꚁꚁ",
  "Ꚃꚃ", "Ꚅꚅ", "Ꚇꚇ", "Ꚉꚉ", "Ꚋꚋ", "Ꚍꚍ", "Ꚏꚏ", "Ꚑꚑ", "Ꚓꚓ", "Ꚕꚕ", "Ꚗꚗ", "Ꚙꚙ",
  "Ꚛꚛ", "Ꜣꜣ", "Ꜥꜥ", "Ꜧꜧ", "Ꜩꜩ", "Ꜫꜫ", "Ꜭꜭ", "Ꜯꜯ", "Ꜳꜳ", "Ꜵꜵ", "Ꜷꜷ", "Ꜹꜹ",
  "Ꜻꜻ", "Ꜽꜽ", "Ꜿꜿ", "Ꝁꝁ", "Ꝃꝃ", "Ꝅꝅ", "Ꝇꝇ", "Ꝉꝉ", "Ꝋꝋ", "Ꝍꝍ", "Ꝏꝏ", "Ꝑꝑ",
  "Ꝓꝓ", "Ꝕꝕ", "Ꝗꝗ", "Ꝙꝙ", "Ꝛꝛ", "Ꝝꝝ", "Ꝟꝟ", "Ꝡꝡ", "Ꝣꝣ", "Ꝥꝥ", "Ꝧꝧ", "Ꝩꝩ",
  "Ꝫꝫ", "Ꝭꝭ", "Ꝯꝯ", "Ꝺꝺ", "Ꝼꝼ", "Ꝿꝿ", "Ꞁꞁ", "Ꞃꞃ", "Ꞅꞅ", "Ꞇꞇ", "Ꞌꞌ", "Ꞑꞑ",
  "Ꞓꞓ", "ꞔꟄ", "Ꞗꞗ", "Ꞙꞙ", "Ꞛꞛ", "Ꞝꞝ", "Ꞟꞟ", "Ꞡꞡ", "Ꞣꞣ", "Ꞥꞥ", "Ꞧꞧ", "Ꞩꞩ",
  "Ꭓꭓ", "Ꞵꞵ", "Ꞷꞷ", "Ꞹꞹ", "Ꞻꞻ", "Ꞽꞽ", "Ꞿꞿ", "Ꟁꟁ", "Ꟃꟃ", "Ꟈꟈ", "Ꟊꟊ", "Ꟍꟍ",
  "Ꟑꟑ", "Ꟗꟗ", "Ꟙꟙ", "Ꟛꟛ", "Ꟶꟶ", "ﬅﬆ", "Ａａ", "Ｂｂ", "Ｃｃ", "Ｄｄ", "Ｅｅ", "Ｆｆ",
  "Ｇｇ", "Ｈｈ", "Ｉｉ", "Ｊｊ", "Ｋｋ", "Ｌｌ", "Ｍｍ", "Ｎｎ", "Ｏｏ", "Ｐｐ", "Ｑｑ", "Ｒｒ",
  "Ｓｓ", "Ｔｔ", "Ｕｕ", "Ｖｖ", "Ｗｗ", "Ｘｘ", "Ｙｙ", "Ｚｚ", "𐐀𐐨", "𐐁𐐩", "𐐂𐐪", "𐐃𐐫",
  "𐐄𐐬", "𐐅𐐭", "𐐆𐐮", "𐐇𐐯", "𐐈𐐰", "𐐉𐐱", "𐐊𐐲", "𐐋𐐳", "𐐌𐐴", "𐐍𐐵", "𐐎𐐶", "𐐏𐐷",
  "𐐐𐐸", "𐐑𐐹", "𐐒𐐺", "𐐓𐐻", "𐐔𐐼", "𐐕𐐽", "𐐖𐐾", "𐐗𐐿", "𐐘𐑀", "𐐙𐑁", "𐐚𐑂", "𐐛𐑃",
  "𐐜𐑄", "𐐝𐑅", "𐐞𐑆", "𐐟𐑇", "𐐠𐑈", "𐐡𐑉", "𐐢𐑊", "𐐣𐑋", "𐐤𐑌", "𐐥𐑍", "𐐦𐑎", "𐐧𐑏",
  "𐒰𐓘", "𐒱𐓙", "𐒲𐓚", "𐒳𐓛", "𐒴𐓜", "𐒵𐓝", "𐒶𐓞", "𐒷𐓟", "𐒸𐓠", "𐒹𐓡", "𐒺𐓢", "𐒻𐓣",
  "𐒼𐓤", "𐒽𐓥", "𐒾𐓦", "𐒿𐓧", "𐓀𐓨", "𐓁𐓩", "𐓂𐓪", "𐓃𐓫", "𐓄𐓬", "𐓅𐓭", "𐓆𐓮", "𐓇𐓯",
  "𐓈𐓰", "𐓉𐓱", "𐓊𐓲", "𐓋𐓳", "𐓌𐓴", "𐓍𐓵", "𐓎𐓶", "𐓏𐓷", "𐓐𐓸", "𐓑𐓹", "𐓒𐓺", "𐓓𐓻",
  "𐕰𐖗", "𐕱𐖘", "𐕲𐖙", "𐕳𐖚", "𐕴𐖛", "𐕵𐖜", "𐕶𐖝", "𐕷𐖞", "𐕸𐖟", "𐕹𐖠", "𐕺𐖡", "𐕼𐖣",
  "𐕽𐖤", "𐕾𐖥", "𐕿𐖦", "𐖀𐖧", "𐖁𐖨", "𐖂𐖩", "𐖃𐖪", "𐖄𐖫", "𐖅𐖬", "𐖆𐖭", "𐖇𐖮", "𐖈𐖯",
  "𐖉𐖰", "𐖊𐖱", "𐖌𐖳", "𐖍𐖴", "𐖎𐖵", "𐖏𐖶", "𐖐𐖷", "𐖑𐖸", "𐖒𐖹", "𐖔𐖻", "𐖕𐖼", "𐲀𐳀",
  "𐲁𐳁", "𐲂𐳂", "𐲃𐳃", "𐲄𐳄", "𐲅𐳅", "𐲆𐳆", "𐲇𐳇", "𐲈𐳈", "𐲉𐳉", "𐲊𐳊", "𐲋𐳋", "𐲌𐳌",
  "𐲍𐳍", "𐲎𐳎", "𐲏𐳏", "𐲐𐳐", "𐲑𐳑", "𐲒𐳒", "𐲓𐳓", "𐲔𐳔", "𐲕𐳕", "𐲖𐳖", "𐲗𐳗", "𐲘𐳘",
  "𐲙𐳙", "𐲚𐳚", "𐲛𐳛", "𐲜𐳜", "𐲝𐳝", "𐲞𐳞", "𐲟𐳟", "𐲠𐳠", "𐲡𐳡", "𐲢𐳢", "𐲣𐳣", "𐲤𐳤",
  "𐲥𐳥", "𐲦𐳦", "𐲧𐳧", "𐲨𐳨", "𐲩𐳩", "𐲪𐳪", "𐲫𐳫", "𐲬𐳬", "𐲭𐳭", "𐲮𐳮", "𐲯𐳯", "𐲰𐳰",
  "𐲱𐳱", "𐲲𐳲", "𐵐𐵰", "𐵑𐵱", "𐵒𐵲", "𐵓𐵳", "𐵔𐵴", "𐵕𐵵", "𐵖𐵶", "𐵗𐵷", "𐵘𐵸", "𐵙𐵹",
  "𐵚𐵺", "𐵛𐵻", "𐵜𐵼", "𐵝𐵽", "𐵞𐵾", "𐵟𐵿", "𐵠𐶀", "𐵡𐶁", "𐵢𐶂", "𐵣𐶃", "𐵤𐶄", "𐵥𐶅",
  "𑢠𑣀", "𑢡𑣁", "𑢢𑣂", "𑢣𑣃", "𑢤𑣄", "𑢥𑣅", "𑢦𑣆", "𑢧𑣇", "𑢨𑣈", "𑢩𑣉", "𑢪𑣊", "𑢫𑣋",
  "𑢬𑣌", "𑢭𑣍", "𑢮𑣎", "𑢯𑣏", "𑢰𑣐", "𑢱𑣑", "𑢲𑣒", "𑢳𑣓", "𑢴𑣔", "𑢵𑣕", "𑢶𑣖", "𑢷𑣗",
  "𑢸𑣘", "𑢹𑣙", "𑢺𑣚", "𑢻𑣛", "𑢼𑣜", "𑢽𑣝", "𑢾𑣞", "𑢿𑣟", "𖹀𖹠", "𖹁𖹡", "𖹂𖹢", "𖹃𖹣",
  "𖹄𖹤", "𖹅𖹥", "𖹆𖹦", "𖹇𖹧", "𖹈𖹨", "𖹉𖹩", "𖹊𖹪", "𖹋𖹫", "𖹌𖹬", "𖹍𖹭", "𖹎𖹮", "𖹏𖹯",
  "𖹐𖹰", "𖹑𖹱", "𖹒𖹲", "𖹓𖹳", "𖹔𖹴", "𖹕𖹵", "𖹖𖹶", "𖹗𖹷", "𖹘𖹸", "𖹙𖹹", "𖹚𖹺", "𖹛𖹻",
  "𖹜𖹼", "𖹝𖹽", "𖹞𖹾", "𖹟𖹿", "𞤀𞤢", "𞤁𞤣", "𞤂𞤤", "𞤃𞤥", "𞤄𞤦", "𞤅𞤧", "𞤆𞤨", "𞤇𞤩",
  "𞤈𞤪", "𞤉𞤫", "𞤊𞤬", "𞤋𞤭", "𞤌𞤮", "𞤍𞤯", "𞤎𞤰", "𞤏𞤱", "𞤐𞤲", "𞤑𞤳", "𞤒𞤴", "𞤓𞤵",
  "𞤔𞤶", "𞤕𞤷", "𞤖𞤸", "𞤗𞤹", "𞤘𞤺", "𞤙𞤻", "𞤚𞤼", "𞤛𞤽", "𞤜𞤾", "𞤝𞤿", "𞤞𞥀", "𞤟𞥁",
  "𞤠𞥂", "𞤡𞥃",
];
// END GENERATED UNICODE 16.0.0 SIMPLE CASE FOLD CLASSES

const characterPatterns = new Map<string, string>();
const characterVariants = new Map<string, readonly string[]>();
for (const group of SIMPLE_CASE_FOLD_GROUPS) {
  // C/S members never contain GLOB class syntax; the pinned-data test verifies it.
  const pattern = `[${group}]`;
  const variants = Object.freeze([...group]);
  for (const character of group) {
    characterPatterns.set(character, pattern);
    characterVariants.set(character, variants);
  }
}

/** Exact default-simple-fold alternatives for one Unicode scalar, not a token.
 * Arrays are frozen so a caller cannot alter this shared code-owned lookup. */
export function sqliteUnicodeCaseVariants(character: string): readonly string[] {
  if (typeof character !== "string" || character.length < 1 || character.length > 2 ||
    Array.from(character).length !== 1 || /\u0000|[\uD800-\uDFFF]/u.test(character)) {
    throw new RangeError("A Unicode case variant input must be one non-NUL Unicode scalar.");
  }
  return characterVariants.get(character) ?? Object.freeze([character]);
}

/**
 * Return a bound-parameter GLOB pattern matching this literal token anywhere.
 * Callers must bind the result, never interpolate it into SQL. The input bound
 * is UTF-16 units, matching retrieval fullText's 300-unit query limit.
 *
 * A four-member class needs at most six UTF-16 units, so the output is at most
 * 1802 units including the two substring wildcards (and at most 4202 UTF-8 bytes).
 * NUL and lone surrogates cannot survive SQLite's text boundary exactly.
 */
export function sqliteUnicodeLiteralPattern(token: string): string {
  if (typeof token !== "string" || token.length === 0 || token.length > 300 ||
    /\u0000|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(token)) {
    throw new RangeError("A Unicode search token must be 1–300 UTF-16 units without NUL or lone surrogates.");
  }
  let result = "*";
  for (const character of token) {
    const folded = characterPatterns.get(character);
    if (folded) result += folded;
    else if (character === "[") result += "[[]";
    else if (character === "]") result += "[]]";
    else if (character === "*") result += "[*]";
    else if (character === "?") result += "[?]";
    else result += character;
  }
  return result + "*";
}
