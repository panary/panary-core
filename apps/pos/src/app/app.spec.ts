import { TestBed } from '@angular/core/testing'
import { provideRouter } from '@angular/router'
import { signal } from '@angular/core'
import { AppComponent } from './app'
import { ConnectionService, LanguageService } from '@panary-core/shared/data-access'
import { TranslateModule } from '@ngx-translate/core'

describe('AppComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppComponent, TranslateModule.forRoot()],
      providers: [
        provideRouter([]),
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
        {
          provide: LanguageService,
          useValue: {
            currentLanguage: signal('de'),
            languages: [],
            loadLanguagePreference: () => Promise.resolve(),
            setLanguage: () => Promise.resolve(),
          },
        },
      ],
    }).compileComponents()
  })

  it('should create the app', () => {
    const fixture = TestBed.createComponent(AppComponent)
    expect(fixture.componentInstance).toBeTruthy()
  })
})
