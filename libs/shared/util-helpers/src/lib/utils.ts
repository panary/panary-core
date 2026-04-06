export class Utils {
  static readonly validHosts: string[] = ['localhost']

  // ref: http://stackoverflow.com/a/2117523/1090359
  static newGuid(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = (Math.random() * 16) | 0
      const v = c === 'x' ? r : (r & 0x3) | 0x8
      return v.toString(16)
    })
  }

  static guidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

  static isGuid(id: string) {
    return RegExp(Utils.guidRegex, 'i').test(id)
  }

  static convertToNumber(value: null | string | number): number {
    if (!value) return 0
    if (typeof value === 'number') return value

    const parsedValue = parseFloat(value.toString().replace(/,/, '.'))

    if (isNaN(parsedValue)) return 0

    return parsedValue
  }

  static getHostname(uriString: string): string | null {
    if (Utils.isNullOrWhitespace(uriString)) {
      return null
    }

    uriString = uriString.trim()

    if (uriString.startsWith('data:')) {
      return null
    }

    if (uriString.startsWith('about:')) {
      return null
    }

    if (uriString.startsWith('file:')) {
      return null
    }

    // Does uriString contain invalid characters
    // TODO Needs to possibly be extended, although '!' is a reserved character
    if (uriString.indexOf('!') > 0) {
      return null
    }

    try {
      const hostname = uriString //getHostname(uriString, { validHosts: this.validHosts });
      if (hostname != null) {
        return hostname
      }
    } catch {
      return null
    }
    return null
  }

  static getHost(uriString: string): string | null {
    const url = Utils.getUrl(uriString)
    try {
      return url != null && url.host !== '' ? url.host : null
    } catch {
      return null
    }
  }

  static getDomain(uriString: string): string | null {
    if (Utils.isNullOrWhitespace(uriString)) {
      return null
    }

    uriString = uriString.trim()

    if (uriString.startsWith('data:')) {
      return null
    }

    if (uriString.startsWith('about:')) {
      return null
    }

    try {
      const parseResult = { hostname: 'localhost', isIp: false, domain: '' } //parse(uriString, {validHosts: this.validHosts, allowPrivateDomains: true,});
      if (parseResult != null && parseResult.hostname != null) {
        if (parseResult.hostname === 'localhost' || parseResult.isIp) {
          return parseResult.hostname
        }

        if (parseResult.domain != null) {
          return parseResult.domain
        }
        return null
      }
    } catch {
      return null
    }
    return null
  }

  static getQueryParams(uriString: string): Map<string, string> | null {
    const url = Utils.getUrl(uriString)
    if (url == null || url.search == null || url.search === '') {
      return null
    }
    const map = new Map<string, string>()
    const pairs = (url.search[0] === '?' ? url.search.substr(1) : url.search).split('&')
    pairs.forEach(pair => {
      const parts = pair.split('=')
      if (parts.length < 1) {
        return
      }
      map.set(decodeURIComponent(parts[0]).toLowerCase(), parts[1] == null ? '' : decodeURIComponent(parts[1]))
    })
    return map
  }

  static isNullOrWhitespace(str: string): boolean {
    return str == null || typeof str !== 'string' || str.trim() === ''
  }

  static isNullOrEmpty(str: string): boolean {
    return str == null || typeof str !== 'string' || str == ''
  }

  static getUrl(uriString: string): URL | null {
    if (this.isNullOrWhitespace(uriString)) {
      return null
    }

    uriString = uriString.trim()

    return Utils.getUrlObject(uriString)
  }

  /**
   * Extrahiert die Basis-URL aus einer vollständigen URL.
   *
   * @param urlString - Die vollständige URL als String.
   * @returns Die Basis-URL als String.
   * @throws Eine Fehlermeldung, wenn die eingegebene URL ungültig ist.
   */
  static getBaseUrl(urlString: string): string {
    try {
      const url = new URL(urlString)
      return `${url.protocol}//${url.host}`
    } catch {
      throw new Error(`Ungültige URL: ${urlString}`)
    }
  }

  static camelToPascalCase(s: string) {
    return s.charAt(0).toUpperCase() + s.slice(1)
  }

  private static getUrlObject(uriString: string): URL | null {
    // All the methods below require a protocol to properly parse a URL string
    // Assume http if no other protocol is present
    const hasProtocol = uriString.indexOf('://') > -1
    if (!hasProtocol && uriString.indexOf('.') > -1) {
      uriString = 'http://' + uriString
    } else if (!hasProtocol) {
      return null
    }

    try {
      // URL ist in modernen Browsern und Node.js (>= 10) global verfügbar
      return new URL(uriString)
    } catch {
      // Ignore error
    }

    return null
  }
}
