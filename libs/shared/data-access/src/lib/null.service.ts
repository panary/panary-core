import { NotImplemented } from '@feathersjs/errors'

export class NullService {
  async find() {
    throw new NotImplemented('This feature is not available in the Core version.')
  }
  async get() {
    throw new NotImplemented('This feature is not available in the Core version.')
  }
  async create() {
    throw new NotImplemented('This feature is not available in the Core version.')
  }
  async update() {
    throw new NotImplemented('This feature is not available in the Core version.')
  }
  async patch() {
    throw new NotImplemented('This feature is not available in the Core version.')
  }
  async remove() {
    throw new NotImplemented('This feature is not available in the Core version.')
  }
}
