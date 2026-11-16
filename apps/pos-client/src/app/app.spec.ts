import { TestBed } from '@angular/core/testing'
import { provideRouter } from '@angular/router'
import { provideHttpClient } from '@angular/common/http'
import { signal } from '@angular/core'
import { AppComponent } from './app'
import {
  CloudStatusBannerService,
  ConnectionService,
  LanguageService,
  PosVersionPolicyService,
} from '@panary/shared/data-access'
import { ThemeServiceService } from '@panary/shared/data-access-theme'
import { TranslateModule } from '@ngx-translate/core'

async function configure(warn = false) {
  {
    await TestBed.configureTestingModule({
      imports: [AppComponent, TranslateModule.forRoot()],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        {
          provide: ConnectionService,
          useValue: {
            connectionState: signal({
              status: 'disconnected',
              connectedAt: '-',
              error: null,
              deviceId: null,
            }),
            isAuthenticated: () => false,
          },
        },
        // Der Cloud-Banner ist nicht Gegenstand dieser Spec; sein echter Dienst braucht den ganzen ConnectionService.
        { provide: CloudStatusBannerService, useValue: { activeBanner: signal(null) } },
        {
          provide: PosVersionPolicyService,
          useValue: { warn: signal(warn), posVersion: '26.8.1', edgeVersion: signal<string | null>('26.11.19') },
        },
        {
          provide: LanguageService,
          useValue: {
            currentLanguage: signal('de'),
            languages: [],
            loadLanguagePreference: () => Promise.resolve(),
            setLanguage: () => Promise.resolve(),
          },
        },
        {
          provide: ThemeServiceService,
          useValue: {
            theme: 'system',
            setTheme: () => Promise.resolve(),
          },
        },
      ],
    }).compileComponents()
  }
}

describe('AppComponent', () => {
  it('should create the app', async () => {
    await configure()
    const fixture = TestBed.createComponent(AppComponent)
    expect(fixture.componentInstance).toBeTruthy()
  })

  // Versionshinweis (core#1441): ein Streifen, der den Verkauf nicht blockiert.
  it('zeigt den Versionsstreifen mit beiden Versionen, wenn der POS hinter dem Edge liegt', async () => {
    await configure(true)
    const fixture = TestBed.createComponent(AppComponent)
    fixture.detectChanges()

    const strip = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="pos-version-warning"]')
    expect(strip).not.toBeNull()
    expect(strip?.getAttribute('role')).toBe('status')
    expect(strip?.textContent).toContain('VERSION.BEHIND_WARNING')
  })

  it('zeigt keinen Versionsstreifen ohne Rückstand', async () => {
    await configure(false)
    const fixture = TestBed.createComponent(AppComponent)
    fixture.detectChanges()

    expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="pos-version-warning"]')).toBeNull()
  })
})
