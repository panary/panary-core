import { TestBed } from '@angular/core/testing'
import { App } from './app'
import { TranslateModule } from '@ngx-translate/core'

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App, TranslateModule.forRoot()],
    }).compileComponents()
  })

  it('should create the app', async () => {
    const fixture = TestBed.createComponent(App)
    await fixture.whenStable()
    expect(fixture.componentInstance).toBeTruthy()
  })
})
