from __future__ import annotations


class AppError(Exception):
  def __init__(self, code: str, message: str, status_code: int = 400) -> None:
    super().__init__(message)
    self.code = code
    self.message = message
    self.status_code = status_code


def ensure(condition: bool, code: str, message: str, status_code: int = 400) -> None:
  if not condition:
    raise AppError(code, message, status_code=status_code)
