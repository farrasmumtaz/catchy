import subprocess
import unittest
from unittest.mock import patch

import setup


class SetupTests(unittest.TestCase):
    def test_pgpass_reserved_characters(self):
        self.assertEqual(setup.pgpass_escape('ab:cd\\ef'), 'ab\\:cd\\\\ef')

    def test_empty_password_is_rejected(self):
        with patch('setup.getpass.getpass', return_value=''):
            with self.assertRaises(ValueError):
                setup.ask_password('Password: ')

    def test_database_error_does_not_disclose_credentials(self):
        result = subprocess.CompletedProcess([], 1, '', 'sensitive query and hash')
        with patch('setup.subprocess.run', return_value=result) as run:
            with self.assertRaises(RuntimeError) as caught:
                setup.query('sensitive query and hash', 'test-password')
        self.assertNotIn('sensitive query', str(caught.exception))
        self.assertNotIn('test-password', ' '.join(run.call_args.args[0]))
        self.assertEqual(run.call_args.kwargs['env']['PGPASSWORD'], 'test-password')


if __name__ == '__main__':
    unittest.main()
