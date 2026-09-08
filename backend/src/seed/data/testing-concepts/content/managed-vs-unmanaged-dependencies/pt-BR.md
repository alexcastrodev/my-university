---
version: 1.0
updatedAt: 2026-08-13
title: "Dependências Gerenciadas vs. Não Gerenciadas em Testes de Integração"
summary: "Por que um teste de integração deve acessar um banco de dados real (uma dependência gerenciada) mas mockar um servidor SMTP ou barramento de mensagens (uma dependência não gerenciada), e por que mockar uma dependência gerenciada quebra silenciosamente a resistência à refatoração."
---
## Objective

Entender a distinção de Khorikov entre dependências gerenciadas e não gerenciadas fora de processo: a regra que decide se um teste de integração deve acessar um banco de dados real ou mockar um colaborador, e por que inverter isso quebra silenciosamente a resistência à refatoração de uma suíte de testes.

## Use Cases

- Decidir se um teste de integração deve subir um banco de dados de teste real ou mockar a camada de repositório.
- Decidir se deve mockar um servidor SMTP ou um barramento de mensagens em um teste de integração, em vez de assumir "sistema externo, sempre mockar".
- Lidar com um banco de dados que começou privado à sua aplicação, mas agora tem algumas tabelas que o sistema de outro time também lê.

## Deep Dive

### Dois tipos de dependência fora de processo

Toda dependência fora de processo (banco de dados, servidor SMTP, barramento de mensagens, API de terceiros) se encaixa em uma de duas categorias:

- **Dependência gerenciada**: só a sua aplicação fala com ela. Um banco de dados típico, acessível exclusivamente pela sua própria API; nenhum sistema externo se conecta a ele diretamente.
- **Dependência não gerenciada**: outras aplicações observam ou dependem de como você fala com ela. Um servidor SMTP, um barramento de mensagens; enviar um e-mail ou publicar uma mensagem é um efeito colateral visível fora do seu sistema, não apenas um detalhe de implementação de como você guarda seu estado.

### A regra: instâncias reais para gerenciadas, mocks para não gerenciadas

```
Dependência gerenciada (ex.: seu próprio banco de dados)   → use uma instância REAL em testes de integração
Dependência não gerenciada (ex.: SMTP, barramento)         → substitua por um MOCK em testes de integração
```

O raciocínio se conecta diretamente ao pilar de resistência à refatoração dos quatro pilares: a comunicação com uma dependência gerenciada é um **detalhe de implementação**; nada fora da sua aplicação se importa com como você organiza as tabelas do seu próprio banco de dados, então um teste que verifica o *estado final* do banco sobrevive a uma refatoração como renomear uma coluna ou migrar de motor. A comunicação com uma dependência não gerenciada é **comportamento observável**; outro sistema está esperando aquele e-mail ou aquela mensagem, então um teste precisa verificar a *interação em si* permanecendo a mesma, que é exatamente para o que serve o `verify()` de um mock.

### Quando uma dependência é as duas coisas: o caso do banco de dados compartilhado

Uma complicação comum do mundo real: um banco de dados que começou totalmente privado gradualmente ganha algumas tabelas expostas ao sistema de outro time para facilitar a integração. Uma vez que isso acontece, o banco de dados é genuinamente gerenciado e não gerenciado ao mesmo tempo, e a correção é tratá-lo como duas dependências, não uma:

```
Tabelas visíveis apenas para a sua aplicação  → gerenciada: testar diretamente, verificar o estado final
Tabelas visíveis para aplicações externas     → não gerenciada: mockar, verificar o padrão de interação
```

Essas tabelas expostas externamente funcionam como um barramento de mensagens, com linhas fazendo o papel de mensagens, e o livro é explícito ao afirmar que compartilhar um banco de dados entre sistemas dessa forma é um padrão de integração pobre, para começo de conversa (uma API ou um barramento de mensagens real é melhor); vale destacar isso como uma situação de "fizemos isso porque tivemos que fazer, não porque é o objetivo de design", não como uma técnica para adotar de propósito.

## Trade-offs

- **Mockar uma dependência gerenciada anula completamente o propósito de escrever o teste de integração**: isso compromete diretamente a resistência à refatoração (uma refatoração de banco de dados que não muda nada observável ainda pode quebrar um teste mockado) e reduz a proteção do teste contra regressões a "o controller chama o método certo do repositório", o que os testes unitários já cobrem de forma mais barata.
- **Se você genuinamente não pode usar uma instância real de uma dependência gerenciada (por exemplo, um banco de dados legado bloqueado pela política de TI para qualquer ambiente de teste), o conselho do livro é pular o teste de integração ali por completo**, em vez de mockar; um teste de integração construído ao redor de uma dependência gerenciada mockada não oferece praticamente nenhum valor adicional sobre a suíte de testes unitários que ele duplica, e ainda custa todo o encanamento de um teste de integração.
- **O rótulo gerenciada/não gerenciada vive no papel da dependência, não na sua tecnologia**: um banco de dados costuma ser gerenciado, mas no momento em que qualquer parte dele se torna observável externamente (tabelas compartilhadas, um sistema legado lendo dele diretamente), essa parte vira não gerenciada, independentemente de continuar sendo "só um banco de dados" por baixo.

## Documentation Links

- Vladimir Khorikov, *Unit Testing Principles, Practices, and Patterns* (Manning, 2020), Capítulo 8 "Why Integration Testing?", "Which Out-of-Process Dependencies to Test Directly", pp. 190-193 (book)
