'use strict'

const ERROR_CODES = {
  '100': {
    phrase: ['Continue', 'Fortfahren'],
    description: [
      "The server has received the request headers and the client should proceed to send the request body (in the case of a request for which a body needs to be sent; for example, a POST request). Sending a large request body to a server after a request has been rejected for inappropriate headers would be inefficient. To have a server check the request's headers, a client must send Expect: 100-continue as a header in its initial request and receive a 100 Continue status code in response before sending the body. The response 417 Expectation Failed indicates the request should not be continued.",
      'Der Server hat die Kopfzeilen der Anfrage erhalten, und der Client sollte nun den Body der Anfrage senden (im Falle einer Anfrage, für die ein Body gesendet werden muss, z. B. eine POST-Anfrage). Es wäre ineffizient, einen großen Request Body an einen Server zu senden, nachdem eine Anfrage wegen unpassender Header abgelehnt wurde. Damit ein Server die Kopfzeilen der Anforderung prüfen kann, muss ein Client Expect: 100-continue als Kopfzeile in seiner anfänglichen Anforderung senden und als Antwort einen 100 Continue-Statuscode erhalten, bevor er den Body sendet. Die Antwort 417 Expectation Failed zeigt an, dass die Anfrage nicht fortgesetzt werden sollte.',
    ],
  },
  '101': {
    phrase: ['Switching Protocols', 'Wechsel der Protokolle'],
    description: [
      'The requester has asked the server to switch protocols and the server has agreed to do so.',
      'Der Antragsteller hat den Server gebeten, das Protokoll zu wechseln, und der Server hat dem zugestimmt.',
    ],
  },
  '102': {
    phrase: ['Processing', 'Verarbeitung'],
    description: [
      'A WebDAV request may contain many sub-requests involving file operations, requiring a long time to complete the request. This code indicates that the server has received and is processing the request, but no response is available yet. This prevents the client from timing out and assuming the request was lost.',
      'Eine WebDAV-Anfrage kann viele Unteranfragen mit Dateivorgängen enthalten, so dass es lange dauert, bis die Anfrage abgeschlossen ist. Dieser Code zeigt an, dass der Server die Anfrage erhalten hat und bearbeitet, aber noch keine Antwort vorliegt. Damit wird verhindert, dass der Client eine Zeitüberschreitung feststellt und annimmt, die Anfrage sei verloren gegangen.',
    ],
  },
  '103': {
    phrase: ['Checkpoint', 'Frühzeitige Hinweise'],
    description: [
      'A POST or PUT request that was previously aborted is to be resumed.',
      'Eine POST- oder PUT-Anfrage, die zuvor abgebrochen wurde, soll wiederaufgenommen werden.',
    ],
  },
  '1xx': {
    phrase: ['Informational', 'Informativ'],
    description: [
      'Request received, continuing process. This class of status code indicates a provisional response, consisting only of the Status-Line and optional headers, and is terminated by an empty line. Since HTTP/1.0 did not define any 1xx status codes, servers must not send a 1xx response to an HTTP/1.0 client except under experimental conditions.',
      'Anfrage erhalten, Prozess wird fortgesetzt. Diese Klasse von Statuscodes zeigt eine vorläufige Antwort an, die nur aus der Status-Zeile und optionalen Headern besteht und durch eine Leerzeile abgeschlossen wird. Da HTTP/1.0 keine 1xx-Statuscodes definiert hat, dürfen Server nur unter experimentellen Bedingungen eine 1xx-Antwort an einen HTTP/1.0-Client senden.',
    ],
  },
  '200': {
    phrase: ['OK', 'Alles in Ordnung'],
    description: [
      'Standard response for successful HTTP requests. The actual response will depend on the request method used. In a GET request, the response will contain an entity corresponding to the requested resource. In a POST request, the response will contain an entity describing or containing the result of the action.',
      'Standardantwort für erfolgreiche HTTP-Anfragen. Die tatsächliche Antwort hängt von der verwendeten Anfragemethode ab. Bei einer GET-Anfrage enthält die Antwort eine Entität, die der angeforderten Ressource entspricht. Bei einer POST-Anfrage enthält die Antwort eine Entität, die das Ergebnis der Aktion beschreibt oder enthält.',
    ],
  },
  '201': {
    phrase: ['Created', 'Erstellt'],
    description: [
      'The request has been fulfilled, resulting in the creation of a new resource.',
      'Die Anforderung wurde erfüllt, was zur Erstellung einer neuen Ressource geführt hat.',
    ],
  },
  '202': {
    phrase: ['Accepted', 'Angenommen'],
    description: [
      'The request has been accepted for processing, but the processing has not been completed. The request might or might not be eventually acted upon, and may be disallowed when processing occurs.',
      'Der Antrag wurde zur Bearbeitung angenommen, aber die Bearbeitung ist noch nicht abgeschlossen. Der Antrag kann bearbeitet werden oder auch nicht, und er kann bei der Bearbeitung abgelehnt werden.',
    ],
  },
  '203': {
    phrase: ['Non-Authoritative Information', 'Nicht autorisierende Informationen'],
    description: [
      "The server is a transforming proxy (e.g. a Web accelerator) that received a 200 OK from its origin, but is returning a modified version of the origin's response.",
      'Der Server ist ein Transforming Proxy (z. B. ein Web Accelerator), der ein 200 OK von seinem Ursprung erhalten hat, aber eine modifizierte Version der Antwort des Ursprungs zurückgibt.',
    ],
  },
  '204': {
    phrase: ['No Content', 'Kein Inhalt'],
    description: [
      'The server successfully processed the request and is not returning any content.',
      'Der Server hat die Anfrage erfolgreich bearbeitet und gibt keine Inhalte zurück.',
    ],
  },
  '205': {
    phrase: ['Reset Content', 'Inhalt zurücksetzen'],
    description: [
      'The server successfully processed the request, but is not returning any content. Unlike a 204 response, this response requires that the requester reset the document view.',
      'Der Server hat die Anfrage erfolgreich verarbeitet, gibt aber keinen Inhalt zurück. Im Gegensatz zu einer 204-Antwort erfordert diese Antwort, dass der Anfragende die Dokumentenansicht zurücksetzt.',
    ],
  },
  '206': {
    phrase: ['Partial Content', 'Teilweiser Inhalt'],
    description: [
      'The server is delivering only part of the resource (byte serving) due to a range header sent by the client. The range header is used by HTTP clients to enable resuming of interrupted downloads, or split a download into multiple simultaneous streams.',
      'Der Server liefert aufgrund eines vom Client gesendeten Range-Headers nur einen Teil der Ressource (Byte serving). Der Range-Header wird von HTTP-Clients verwendet, um die Wiederaufnahme unterbrochener Downloads zu ermöglichen oder einen Download in mehrere gleichzeitige Streams aufzuteilen.',
    ],
  },
  '207': {
    phrase: ['Multi-Status', 'Mehrfach-Status'],
    description: [
      'The message body that follows is an XML message and can contain a number of separate response codes, depending on how many sub-requests were made.',
      'Der nachfolgende Nachrichtentext ist eine XML-Nachricht und kann je nach Anzahl der Unterabfragen eine Reihe von Antwortcodes enthalten.',
    ],
  },
  '208': {
    phrase: ['Already Reported', 'Bereits berichtet'],
    description: [
      'The members of a DAV binding have already been enumerated in a previous reply to this request, and are not being included again.',
      'Die Mitglieder einer DAV-Bindung wurden bereits in einer früheren Antwort auf diese Anfrage aufgezählt und werden nicht erneut aufgeführt.',
    ],
  },
  '2xx': {
    phrase: ['Success', 'Erfolg'],
    description: [
      'This class of status codes indicates the action requested by the client was received, understood, accepted, and processed successfully.',
      'Diese Klasse von Statuscodes zeigt an, dass die vom Client angeforderte Aktion empfangen, verstanden, akzeptiert und erfolgreich verarbeitet wurde.',
    ],
  },
  '300': {
    phrase: ['Multiple Choices', 'Mehrere Auswahlmöglichkeiten'],
    description: [
      'Indicates multiple options for the resource from which the client may choose (via agent-driven content negotiation). For example, this code could be used to present multiple video format options, to list files with different filename extensions, or to suggest word-sense disambiguation.',
      'Zeigt mehrere Optionen für die Ressource an, aus denen der Kunde wählen kann (über agentengesteuerte Inhaltsaushandlung). Dieser Code könnte z. B. verwendet werden, um mehrere Optionen für das Videoformat zu präsentieren, Dateien mit verschiedenen Dateinamenerweiterungen aufzulisten oder die Disambiguierung von Wortbedeutungen vorzuschlagen.',
    ],
  },
  '301': {
    phrase: ['Moved Permanently', 'Dauerhaft verschoben'],
    description: [
      'This and all future requests should be directed to the given URI.',
      'Diese und alle zukünftigen Anfragen sollten an die angegebene URI gerichtet werden.',
    ],
  },
  '302': {
    phrase: ['Found', 'Gefunden'],
    description: [
      "This is an example of industry practice contradicting the standard. The HTTP/1.0 specification (RFC 1945) required the client to perform a temporary redirect (the original describing phrase was 'Moved Temporarily'), but popular browsers implemented 302 with the functionality of a 303 See Other. Therefore, HTTP/1.1 added status codes 303 and 307 to distinguish between the two behaviours. However, some Web applications and frameworks use the 302 status code as if it were the 303.",
      'Dies ist ein Beispiel dafür, dass die Industriepraxis dem Standard widerspricht. Die HTTP/1.0-Spezifikation (RFC 1945) verlangte, dass der Client eine vorübergehende Umleitung durchführt (der ursprüngliche beschreibende Ausdruck war "Moved Temporarily"), aber die gängigen Browser implementierten 302 mit der Funktionalität eines 303 See Other. Daher fügte HTTP/1.1 die Statuscodes 303 und 307 hinzu, um zwischen diesen beiden Verhaltensweisen zu unterscheiden. Einige Webanwendungen und Frameworks verwenden den Statuscode 302 jedoch so, als wäre er 303.',
    ],
  },
  '303': {
    phrase: ['See Other', 'Siehe Sonstiges'],
    description: [
      'The response to the request can be found under another URI using a GET method. When received in response to a POST (or PUT/DELETE), the client should presume that the server has received the data and should issue a redirect with a separate GET message.',
      'Die Antwort auf die Anfrage kann unter einer anderen URI mit einer GET-Methode gefunden werden. Wird sie als Antwort auf einen POST (oder PUT/DELETE) empfangen, sollte der Client davon ausgehen, dass der Server die Daten erhalten hat, und eine Weiterleitung mit einer separaten GET-Nachricht vornehmen.',
    ],
  },
  '304': {
    phrase: ['Not Modified', 'Nicht modifiziert'],
    description: [
      'Indicates that the resource has not been modified since the version specified by the request headers If-Modified-Since or If-None-Match. In such case, there is no need to retransmit the resource since the client still has a previously-downloaded copy.',
      'Zeigt an, dass die Ressource seit der in den Anforderungsheadern If-Modified-Since oder If-None-Match angegebenen Version nicht geändert wurde. In diesem Fall muss die Ressource nicht erneut übertragen werden, da der Client noch über eine zuvor heruntergeladene Kopie verfügt.',
    ],
  },
  '305': {
    phrase: ['Use Proxy', 'Proxy verwenden'],
    description: [
      'The requested resource is available only through a proxy, the address for which is provided in the response. Many HTTP clients (such as Mozilla and Internet Explorer) do not correctly handle responses with this status code, primarily for security reasons.',
      'Die angeforderte Ressource ist nur über einen Proxy verfügbar, dessen Adresse in der Antwort angegeben ist. Viele HTTP-Clients (z. B. Mozilla und Internet Explorer) verarbeiten Antworten mit diesem Statuscode nicht korrekt, hauptsächlich aus Sicherheitsgründen.',
    ],
  },
  '306': {
    phrase: ['Switch Proxy', 'Proxy wechseln'],
    description: [
      "No longer used. Originally meant 'Subsequent requests should use the specified proxy.'",
      "Wird nicht mehr verwendet. Bedeutete ursprünglich 'Nachfolgende Anfragen sollten den angegebenen Proxy verwenden'.",
    ],
  },
  '307': {
    phrase: ['Temporary Redirect', 'Vorübergehende Umleitung'],
    description: [
      'In this case, the request should be repeated with another URI; however, future requests should still use the original URI. In contrast to how 302 was historically implemented, the request method is not allowed to be changed when reissuing the original request. For example, a POST request should be repeated using another POST request.',
      'In diesem Fall sollte die Anfrage mit einer anderen URI wiederholt werden; künftige Anfragen sollten jedoch weiterhin die ursprüngliche URI verwenden. Im Gegensatz zur historischen Implementierung von 302 darf die Anfragemethode beim erneuten Ausstellen der ursprünglichen Anfrage nicht geändert werden. So sollte beispielsweise eine POST-Anfrage mit einer anderen POST-Anfrage wiederholt werden.',
    ],
  },
  '308': {
    phrase: ['Permanent Redirect', 'Permanente Umleitung'],
    description: [
      'The request and all future requests should be repeated using another URI. 307 and 308 parallel the behaviors of 302 and 301, but do not allow the HTTP method to change. So, for example, submitting a form to a permanently redirected resource may continue smoothly.',
      'Die Anfrage und alle zukünftigen Anfragen sollten unter Verwendung einer anderen URI wiederholt werden. 307 und 308 entsprechen dem Verhalten von 302 und 301, lassen aber keine Änderung der HTTP-Methode zu. So kann z. B. die Übermittlung eines Formulars an eine dauerhaft umgeleitete Ressource problemlos fortgesetzt werden.',
    ],
  },
  '3xx': {
    phrase: ['Redirection', 'Umleitung'],
    description: [
      'This class of status code indicates the client must take additional action to complete the request. Many of these status codes are used in URL redirection. A user agent may carry out the additional action with no user interaction only if the method used in the second request is GET or HEAD. A user agent may automatically redirect a request. A user agent should detect and intervene to prevent cyclical redirects.',
      'Diese Klasse von Statuscodes zeigt an, dass der Client zusätzliche Maßnahmen ergreifen muss, um die Anfrage abzuschließen. Viele dieser Statuscodes werden bei der URL-Weiterleitung verwendet. Ein User-Agent kann die zusätzliche Aktion nur dann ohne Benutzerinteraktion durchführen, wenn die in der zweiten Anfrage verwendete Methode GET oder HEAD ist. Ein User-Agent kann eine Anfrage automatisch umleiten. Ein User-Agent sollte zyklische Weiterleitungen erkennen und verhindern.',
    ],
  },
  '400': {
    phrase: ['Bad Request', 'Schlechte Anfrage'],
    description: [
      'The server cannot or will not process the request due to an apparent client error (e.g., malformed request syntax, too large size, invalid request message framing, or deceptive request routing).',
      'Der Server kann oder will die Anfrage aufgrund eines offensichtlichen Client-Fehlers nicht bearbeiten (z. B. fehlerhafte Anfragesyntax, zu großer Umfang, ungültiges Framing der Anfragemeldung oder betrügerische Weiterleitung der Anfrage).',
    ],
  },
  '401': {
    phrase: ['Unauthorized', 'Nicht autorisiert'],
    description: [
      'Authentication is missing or invalid. Access denied.',
      'Authentifizierung fehlt oder ist ungültig. Zugriff verweigert.',
    ],
  },
  '402': {
    phrase: ['Payment Required', 'Zahlung erforderlich'],
    description: [
      'Reserved for future use. The original intention was that this code might be used as part of some form of digital cash or micropayment scheme, but that has not happened, and this code is not usually used. Google Developers API uses this status if a particular developer has exceeded the daily limit on requests.',
      'Reserviert für zukünftige Verwendung. Ursprünglich sollte dieser Code als Teil einer Form von digitalem Bargeld oder Micropayment-Systemen verwendet werden, aber das ist nicht geschehen, und dieser Code wird normalerweise nicht verwendet. Die Google Developers API verwendet diesen Status, wenn ein bestimmter Entwickler das Tageslimit für Anfragen überschritten hat.',
    ],
  },
  '403': {
    phrase: ['Forbidden', 'Der Zugang zu dieser Ressource ist verboten'],
    description: [
      'The request was a valid request, but the server is refusing to respond to it. The user might be logged in but does not have the necessary permissions for the resource.',
      'Die Anfrage war eine gültige Anfrage, aber der Server weigert sich, darauf zu antworten. Der Benutzer ist zwar angemeldet, hat aber nicht die erforderlichen Berechtigungen für die Ressource.',
    ],
  },
  '404': {
    phrase: ['Not Found', 'Nicht gefunden'],
    description: [
      'The requested resource could not be found but may be available in the future. Subsequent requests by the client are permissible.',
      'Die angeforderte Ressource konnte nicht gefunden werden, könnte aber in Zukunft verfügbar sein. Nachfolgende Anfragen des Clients sind zulässig.',
    ],
  },
  '405': {
    phrase: ['Method Not Allowed', 'Nicht erlaubte Methode'],
    description: [
      'A request method is not supported for the requested resource; for example, a GET request on a form which requires data to be presented via POST, or a PUT request on a read-only resource.',
      'Eine Anfragemethode wird für die angefragte Ressource nicht unterstützt, z. B. eine GET-Anfrage für ein Formular, bei dem die Daten per POST übermittelt werden müssen, oder eine PUT-Anfrage für eine schreibgeschützte Ressource.',
    ],
  },
  '406': {
    phrase: ['Not Acceptable', 'Keine akzeptabele Antwort'],
    description: [
      'The requested resource is capable of generating only content not acceptable according to the Accept headers sent in the request.',
      'Die angeforderte Ressource ist in der Lage, nur Inhalte zu erzeugen, die gemäß den in der Anfrage gesendeten Accept-Headern nicht zulässig sind.',
    ],
  },
  '407': {
    phrase: ['Proxy Authentication Required', 'Proxy-Authentifizierung erforderlich'],
    description: [
      'The client must first authenticate itself with the proxy.',
      'Der Client muss sich zunächst beim Proxy authentifizieren.',
    ],
  },
  '408': {
    phrase: ['Request Time-out', 'Request Time-out'],
    description: [
      "The server timed out waiting for the request. According to HTTP specifications: 'The client did not produce a request within the time that the server was prepared to wait. The client MAY repeat the request without modifications at any later time.'",
      "Der Server hat eine Zeitüberschreitung beim Warten auf die Anfrage. Gemäß den HTTP-Spezifikationen: 'Der Client hat innerhalb der Zeit, die der Server bereit war zu warten, keine Anfrage gestellt. Der Client KANN die Anfrage ohne Änderungen zu einem späteren Zeitpunkt wiederholen.",
    ],
  },
  '409': {
    phrase: ['Conflict', 'Konflikt'],
    description: [
      'Indicates that the request could not be processed because of conflict in the request, such as an edit conflict between multiple simultaneous updates.',
      'Zeigt an, dass die Anforderung aufgrund eines Konflikts in der Anforderung nicht verarbeitet werden konnte, z. B. ein Bearbeitungskonflikt zwischen mehreren gleichzeitigen Aktualisierungen.',
    ],
  },
  '410': {
    phrase: ['Gone', 'Fortgegangen'],
    description: [
      "Indicates that the resource requested is no longer available and will not be available again. This should be used when a resource has been intentionally removed and the resource should be purged. Upon receiving a 410 status code, the client should not request the resource in the future. Clients such as search engines should remove the resource from their indices. Most use cases do not require clients and search engines to purge the resource, and a '404 Not Found' may be used instead.",
      'Zeigt an, dass die angeforderte Ressource nicht mehr verfügbar ist und auch nicht mehr verfügbar sein wird. Dies sollte verwendet werden, wenn eine Ressource absichtlich entfernt wurde und die Ressource bereinigt werden sollte. Wenn der Client einen 410-Statuscode erhält, sollte er die Ressource in Zukunft nicht mehr anfordern. Clients, wie z. B. Suchmaschinen, sollten die Ressource aus ihren Indizes entfernen. In den meisten Anwendungsfällen ist es nicht erforderlich, dass Clients und Suchmaschinen die Ressource löschen, stattdessen kann ein "404 Not Found" verwendet werden.',
    ],
  },
  '411': {
    phrase: ['Length Required', 'Erforderliche Länge'],
    description: [
      'The request did not specify the length of its content, which is required by the requested resource.',
      'In der Anfrage wurde die Länge des Inhalts nicht angegeben, die für die angeforderte Ressource erforderlich ist.',
    ],
  },
  '412': {
    phrase: ['Precondition Failed', 'Vorbedingung fehlgeschlagen'],
    description: [
      'The server does not meet one of the preconditions that the requester put on the request.',
      'Der Server erfüllt eine der Voraussetzungen, die der Anfragende an die Anfrage gestellt hat, nicht.',
    ],
  },
  '413': {
    phrase: ['Request Entity Too Large', 'Anfrage Entität zu groß'],
    description: [
      "The request is larger than the server is willing or able to process. Previously called 'Request Entity Too Large'.",
      "Die Anfrage ist größer, als der Server verarbeiten will oder kann. Wurde früher 'Request Entity Too Large' genannt.",
    ],
  },
  '414': {
    phrase: ['Request-URI Too Long', 'Anfrage-URI zu lang'],
    description: [
      "The URI provided was too long for the server to process. Often the result of too much data being encoded as a query-string of a GET request, in which case it should be converted to a POST request. Called 'Request-URI Too Long' previously.",
      "Der angegebene URI war zu lang, um vom Server verarbeitet werden zu können. Oft das Ergebnis von zu vielen Daten, die als Query-String einer GET-Anfrage kodiert wurden. In diesem Fall sollte sie in eine POST-Anfrage umgewandelt werden. Wurde früher als 'Request-URI Too Long' bezeichnet.",
    ],
  },
  '415': {
    phrase: ['Unsupported Media Type', 'Nicht unterstützter Medientyp'],
    description: [
      'The request entity has a media type which the server or resource does not support. For example, the client uploads an image as image/svg+xml, but the server requires that images use a different format.',
      'Die angefragte Entität hat einen Medientyp, den der Server oder die Ressource nicht unterstützt. Der Client lädt beispielsweise ein Bild als image/svg+xml hoch, aber der Server verlangt, dass Bilder ein anderes Format verwenden.',
    ],
  },
  '416': {
    phrase: ['Requested Range Not Satisfiable', 'Gewünschter Bereich nicht zufriedenstellend'],
    description: [
      "The client has asked for a portion of the file (byte serving), but the server cannot supply that portion. For example, if the client asked for a part of the file that lies beyond the end of the file.[46] Called 'Requested Range Not Satisfiable' previously.",
      'Der Client hat einen Teil der Datei angefordert (Byte serving), aber der Server kann diesen Teil nicht liefern. Zum Beispiel, wenn der Client einen Teil der Datei angefordert hat, der über das Ende der Datei hinausgeht.[46] Wurde zuvor als "Requested Range Not Satisfiable" bezeichnet.',
    ],
  },
  '417': {
    phrase: ['Expectation Failed', 'Erwartung gescheitert'],
    description: [
      'The server cannot meet the requirements of the Expect request-header field.',
      'Der Server kann die Anforderungen des Feldes Expect request-header nicht erfüllen.',
    ],
  },
  '418': {
    phrase: ["I'm a teapot", 'Ich bin eine Teekanne'],
    description: [
      "This code was defined in 1998 as one of the traditional IETF April Fools' jokes, in RFC 2324, Hyper Text Coffee Pot Control Protocol, and is not expected to be implemented by actual HTTP servers. The RFC specifies this code should be returned by teapots requested to brew coffee.[49] This HTTP status is used as an Easter egg in some websites, including Google.com.",
      'Dieser Code wurde 1998 als einer der traditionellen IETF-Aprilscherze in RFC 2324, Hyper Text Coffee Pot Control Protocol, definiert und es wird nicht erwartet, dass er von tatsächlichen HTTP-Servern implementiert wird. Der RFC legt fest, dass dieser Code von Teekannen zurückgegeben werden sollte, die zum Aufbrühen von Kaffee aufgefordert werden.[49] Dieser HTTP-Status wird auf einigen Websites, darunter Google.com, als Osterei verwendet.',
    ],
  },
  '421': {
    phrase: ['Unprocessable Entity', 'Unverarbeitbare Entität'],
    description: [
      'The request was directed at a server that is not able to produce a response (for example because a connection reuse).',
      'Die Anfrage wurde an einen Server gerichtet, der nicht in der Lage ist, eine Antwort zu liefern (z. B. weil eine Verbindung wieder aufgenommen wurde).',
    ],
  },
  '422': {
    phrase: ['Misdirected Request', 'Fehlgeleitete Anfrage'],
    description: [
      'The request was well-formed but was unable to be followed due to semantic errors.',
      'Die Anfrage war wohlgeformt, konnte aber aufgrund von semantischen Fehlern nicht weiterverfolgt werden.',
    ],
  },
  '423': {
    phrase: ['Locked', 'Abgeschlossen'],
    description: [
      'The resource that is being accessed is locked.',
      'Die Ressource, auf die zugegriffen wird, ist gesperrt.',
    ],
  },
  '424': {
    phrase: ['Failed Dependency', 'Fehlgeschlagene Dependenz'],
    description: [
      'The request failed due to failure of a previous request (e.g., a PROPPATCH).',
      'Die Anfrage ist gescheitert, weil eine frühere Anfrage (z. B. ein PROPPATCH) fehlgeschlagen ist.',
    ],
  },
  '426': {
    phrase: ['Upgrade Required', 'Upgrade erforderlich'],
    description: [
      'The client should switch to a different protocol such as TLS/1.0, given in the Upgrade header field.',
      'Der Client sollte zu einem anderen Protokoll wie TLS/1.0 wechseln, das im Upgrade-Headerfeld angegeben ist.',
    ],
  },
  '428': {
    phrase: ['Precondition Required', 'Voraussetzung Erforderlich'],
    description: [
      "The origin server requires the request to be conditional. Intended to prevent the 'lost update' problem, where a client GETs a resource's state, modifies it, and PUTs it back to the server, when meanwhile a third party has modified the state on the server, leading to a conflict.",
      'Der Ursprungsserver verlangt, dass die Anfrage an Bedingungen geknüpft ist. Damit soll das Problem der "verlorenen Aktualisierung" verhindert werden, bei dem ein Client den Zustand einer Ressource GET, ändert und PUT zurück an den Server sendet, während eine dritte Partei den Zustand auf dem Server geändert hat, was zu einem Konflikt führt.',
    ],
  },
  '429': {
    phrase: ['Too Many Requests', 'Zu viele Anfragen'],
    description: [
      'The user has sent too many requests in a given amount of time. Intended for use with rate-limiting schemes.',
      'Der Benutzer hat zu viele Anfragen in einer bestimmten Zeitspanne gesendet. Für die Verwendung mit Ratenbegrenzungssystemen vorgesehen.',
    ],
  },
  '431': {
    phrase: ['Request Header Fileds Too Large', 'Kopfzeilendateien zu groß anfordern'],
    description: [
      'The server is unwilling to process the request because either an individual header field, or all the header fields collectively, are too large.',
      'Der Server ist nicht bereit, die Anfrage zu bearbeiten, weil entweder ein einzelnes Header-Feld oder alle Header-Felder zusammengenommen zu groß sind.',
    ],
  },
  '451': {
    phrase: ['Unavailable For Legal Reasons', 'Aus rechtlichen Gründen nicht verfügbar'],
    description: [
      'A server operator has received a legal demand to deny access to a resource or to a set of resources that includes the requested resource. The code 451 was chosen as a reference to the novel Fahrenheit 451.',
      'Ein Serverbetreiber hat eine rechtliche Aufforderung erhalten, den Zugang zu einer Ressource oder zu einer Gruppe von Ressourcen, die die angeforderte Ressource enthält, zu verweigern. Der Code 451 wurde in Anlehnung an den Roman Fahrenheit 451 gewählt.',
    ],
  },
  '4xx': {
    phrase: ['Client Error', 'Client Error'],
    description: [
      'The 4xx class of status code is intended for situations in which the client seems to have erred. Except when responding to a HEAD request, the server should include an entity containing an explanation of the error situation, and whether it is a temporary or permanent condition. These status codes are applicable to any request method. User agents should display any included entity to the user.',
      'Der Statuscode der Klasse 4xx ist für Situationen gedacht, in denen der Client einen Fehler gemacht zu haben scheint. Außer bei der Beantwortung einer HEAD-Anfrage sollte der Server eine Entität einfügen, die eine Erklärung der Fehlersituation enthält und angibt, ob es sich um einen vorübergehenden oder dauerhaften Zustand handelt. Diese Statuscodes sind für jede Anfragemethode anwendbar. Benutzeragenten sollten dem Benutzer jede enthaltene Entität anzeigen.',
    ],
  },
  '500': {
    phrase: ['Internal Server Error', 'Interner Serverfehler'],
    description: [
      'A generic error message, given when an unexpected condition was encountered and no more specific message is suitable.',
      'Eine allgemeine Fehlermeldung, die ausgegeben wird, wenn eine unerwartete Bedingung aufgetreten ist und keine spezifischere Meldung geeignet ist.',
    ],
  },
  '501': {
    phrase: ['Not Implemented', 'Nicht implementiert'],
    description: [
      'The server either does not recognize the request method, or it lacks the ability to fulfill the request. Usually this implies future availability (e.g., a new feature of a web-service API).',
      'Der Server erkennt entweder die Anfragemethode nicht, oder er ist nicht in der Lage, die Anfrage zu erfüllen. Normalerweise impliziert dies eine zukünftige Verfügbarkeit (z.B. eine neue Funktion einer Web-Service-API).',
    ],
  },
  '502': {
    phrase: ['Bad Gateway', 'Schlechtes Tor'],
    description: [
      'The server was acting as a gateway or proxy and received an invalid response from the upstream server.',
      'Der Server fungierte als Gateway oder Proxy und erhielt eine ungültige Antwort vom Upstream-Server.',
    ],
  },
  '503': {
    phrase: ['Service Unavailable', 'Dienst nicht verfügbar'],
    description: [
      'The server is currently unavailable (because it is overloaded or down for maintenance). Generally, this is a temporary state.',
      'Der Server ist derzeit nicht verfügbar (weil er überlastet ist oder wegen Wartungsarbeiten nicht erreichbar ist). Im Allgemeinen ist dies ein vorübergehender Zustand.',
    ],
  },
  '504': {
    phrase: ['Gateway Timeout', 'Gateway-Zeitüberschreitung'],
    description: [
      'The server was acting as a gateway or proxy and did not receive a timely response from the upstream server.',
      'Der Server fungierte als Gateway oder Proxy und erhielt nicht rechtzeitig eine Antwort vom Upstream-Server.',
    ],
  },
  '505': {
    phrase: ['HTTP Version Not Supported', 'HTTP-Version wird nicht unterstützt'],
    description: [
      'The server does not support the HTTP protocol version used in the request.',
      'Der Server unterstützt die in der Anfrage verwendete HTTP-Protokollversion nicht.',
    ],
  },
  '506': {
    phrase: ['Variant Also Negotiates', 'Auch die Variante verhandelt'],
    description: [
      'Transparent content negotiation for the request results in a circular reference.',
      'Die transparente Aushandlung des Inhalts der Anfrage führt zu einer zirkulären Referenz.',
    ],
  },
  '507': {
    phrase: ['Insufficient Storage', 'Insuffiziente Lagerung'],
    description: [
      'The server is unable to store the representation needed to complete the request.',
      'Der Server ist nicht in der Lage, die für die Bearbeitung der Anfrage erforderliche Darstellung zu speichern.',
    ],
  },
  '508': {
    phrase: ['Loop Detected', 'Schleife erkannt'],
    description: [
      'The server detected an infinite loop while processing the request (sent in lieu of 208 Already Reported).',
      'Der Server hat bei der Bearbeitung der Anfrage eine Endlosschleife festgestellt (gesendet anstelle von 208 Already Reported).',
    ],
  },
  '509': {
    phrase: ['Bandwidth Limit Exceeded', 'Bandbreitenlimit überschritten'],
    description: [
      'Bandwidth Limit Exceeded. This status code, despite being used by many servers, is not official.',
      'Bandbreitenlimit überschritten. Dieser Statuscode wird zwar von vielen Servern verwendet, ist aber nicht offiziell.',
    ],
  },
  '510': {
    phrase: ['Not Extended', 'Nicht erweitert'],
    description: [
      'Further extensions to the request are required for the server to fulfill it.',
      'Weitere Erweiterungen der Anfrage sind erforderlich, damit der Server sie erfüllen kann.',
    ],
  },
  '511': {
    phrase: ['Network Authentication Required', 'Netzwerk-Authentifizierung erforderlich'],
    description: [
      "The client needs to authenticate to gain network access. Intended for use by intercepting proxies used to control access to the network (e.g., 'captive portals' used to require agreement to Terms of Service before granting full Internet access via a Wi-Fi hotspot).",
      'Der Client muss sich authentifizieren, um Zugang zum Netz zu erhalten. Vorgesehen für die Verwendung durch abfangende Proxys, die zur Kontrolle des Netzzugangs eingesetzt werden (z. B. "Captive Portals", die die Zustimmung zu den Nutzungsbedingungen verlangen, bevor der vollständige Internetzugang über einen Wi-Fi-Hotspot gewährt wird).',
    ],
  },
  '5xx': {
    phrase: ['Server Error', 'Server Error'],
    description: [
      'The server failed to fulfill an apparently valid request. Response status codes beginning with the digit 5 indicate cases in which the server is aware that it has encountered an error or is otherwise incapable of performing the request. Except when responding to a HEAD request, the server should include an entity containing an explanation of the error situation, and indicate whether it is a temporary or permanent condition. Likewise, user agents should display any included entity to the user. These response codes are applicable to any request method.',
      'Der Server konnte eine offensichtlich gültige Anfrage nicht erfüllen. Antwortstatuscodes, die mit der Ziffer 5 beginnen, weisen auf Fälle hin, in denen der Server weiß, dass er auf einen Fehler gestoßen ist oder aus anderen Gründen nicht in der Lage ist, die Anfrage zu erfüllen. Außer bei der Beantwortung einer HEAD-Anfrage sollte der Server eine Entität mit einer Erklärung der Fehlersituation einfügen und angeben, ob es sich um einen vorübergehenden oder dauerhaften Zustand handelt. Ebenso sollten die Benutzeragenten dem Benutzer jede enthaltene Entität anzeigen. Diese Antwortcodes gelten für jede Anfragemethode.',
    ],
  },
}
type ErrorCodesString = keyof typeof ERROR_CODES

enum LanguageIndex {
  EN = 0,
  DE = 1,
}

type LanguageIndexString = keyof typeof LanguageIndex

class HttpErrorCodes {
  /** PRIVATE PROPERTIES */
  private _language: LanguageIndexString
  private _supportedLanguages: string[] = ['EN', 'DE']

  /** PUBLIC PROPERTIES */

  /** GETTERS */
  get language(): string {
    return this._language
  }

  /** SETTERS */

  /** CONSTRUCTOR */
  constructor(language: string) {
    if (this._supportedLanguages.indexOf(language) === -1) {
      throw new Error('Language not supported')
    }
    this._language = language as LanguageIndexString
  }

  /** PUBLIC METHODS */
  public getErrorPhrase(code: string | number): string {
    if (typeof code === 'number') {
      code = code.toString()
    }
    return ERROR_CODES[code as ErrorCodesString].phrase[LanguageIndex[this._language]]
  }

  public getErrorDescription(code: string | number): string {
    if (typeof code === 'number') {
      code = code.toString()
    }
    return ERROR_CODES[code as ErrorCodesString].description[LanguageIndex[this._language]]
  }
}

export default HttpErrorCodes
export const httpErrorCodesDE = new HttpErrorCodes('DE')
