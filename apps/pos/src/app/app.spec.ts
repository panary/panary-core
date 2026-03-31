import { TestBed } from '@angular/core/testing'
import { provideRouter } from '@angular/router'
import { signal } from '@angular/core'
import { AppComponent } from './app'
import { ConnectionService } from '@panary-core/shared/data-access'

describe('AppComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppComponent],
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
